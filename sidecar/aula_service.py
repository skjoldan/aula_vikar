import datetime as dt
import json
import os
import sys
import threading
import time
from pathlib import Path

import requests


AULA_COMPONENT_ROOT = (
    Path(__file__).resolve().parents[1]
    / "vendor"
    / "aula"
    / "custom_components"
    / "aula"
)
sys.path.insert(0, str(AULA_COMPONENT_ROOT))

from aula_login_client.client import AulaLoginClient  # noqa: E402
import const as aula_const  # noqa: E402


DEFAULT_API_VERSION = int(aula_const.API_VERSION)
MAX_API_BUMP = 5


class AulaServiceError(Exception):
    pass


class AulaService:
    def __init__(self):
        self._sessions = {}
        self._auth_jobs = {}
        self._debug = bool(os.environ.get("AULA_DEBUG"))
        self._debug_level = os.environ.get("AULA_DEBUG_LEVEL", "info").lower()

    def _log(self, message, level="info"):
        if not self._debug:
            return
        if self._debug_level == "verbose":
            print(message)
            return
        if level == "info":
            print(message)

    def get_session(self, mitid_username, mitid_password, auth_method, mitid_identity):
        status = self.ensure_session(
            mitid_username, mitid_password, auth_method, mitid_identity
        )
        if status["status"] != "ready":
            raise AulaServiceError(status.get("error") or "MitID login pending")
        return status["session"]

    def ensure_session(self, mitid_username, mitid_password, auth_method, mitid_identity):
        cache_key = f"{mitid_username}:{auth_method}:{mitid_identity or 1}"
        cached = self._sessions.get(cache_key)
        if cached and cached.get("tokens"):
            client = cached["client"]
            if self._tokens_valid(client) or self._refresh_tokens(client):
                return {"status": "ready", "session": cached}

        job = self._auth_jobs.get(cache_key)
        if job and job["done"]:
            if job["error"]:
                return {"status": "error", "error": job["error"]}
            if job["tokens"]:
                client = job["client"]
                api_base = self._discover_api_base(
                    client.session, job["tokens"]["access_token"]
                )
                self._apply_access_token(client, job["tokens"])
                session_data = {
                    "client": client,
                    "tokens": job["tokens"],
                    "api_base": api_base,
                }
                self._sessions[cache_key] = session_data
                self._auth_jobs.pop(cache_key, None)
                return {"status": "ready", "session": session_data}
        if job and not job["done"]:
            return self._job_status(job)

        new_job = self._start_auth_job(
            cache_key, mitid_username, mitid_password, auth_method, mitid_identity
        )
        return self._job_status(new_job)

    def _start_auth_job(self, cache_key, mitid_username, mitid_password, auth_method, mitid_identity):
        client = AulaLoginClient(
            mitid_username=mitid_username,
            mitid_password=mitid_password,
            auth_method=auth_method,
            debug=False,
            verbose=False,
        )
        client.identity_selector = lambda names: str(mitid_identity or 1)
        job = {
            "client": client,
            "done": False,
            "error": None,
            "tokens": None,
            "started_at": time.time(),
            "last_status": "starting",
        }
        def run():
            try:
                job["last_status"] = "authenticating"
                result = client.authenticate()
                if not result.get("success"):
                    job["error"] = result.get("error") or "Authentication failed"
                else:
                    job["tokens"] = result["tokens"]
            except Exception as exc:
                job["error"] = str(exc)
            finally:
                job["done"] = True

        thread = threading.Thread(target=run, daemon=True)
        job["thread"] = thread
        self._auth_jobs[cache_key] = job
        thread.start()
        return job

    def _job_status(self, job):
        client = job["client"]

        status_message = None
        otp_code = None
        qr_svgs = None

        mitid_client = client.get_mitid_client()
        if mitid_client:
            status_message = getattr(mitid_client, "status_message", None)
            otp_code = getattr(mitid_client, "otp_code", None)

            # vendor client returns either None or a tuple/list of two SVG strings
            try:
                qr = client.get_qr_codes_svg()
                if qr and isinstance(qr, (tuple, list)) and len(qr) >= 2:
                    qr_svgs = [qr[0], qr[1]]
                elif isinstance(qr, str):
                    qr_svgs = [qr]
            except Exception:
                qr_svgs = None

        return {
            "status": "pending",
            "message": status_message or job.get("last_status") or "Pending",
            "otpCode": otp_code,
            "qrSvgs": qr_svgs,
            "qrSvg": (qr_svgs[0] if qr_svgs else None),
        }

    def reset_session(self, mitid_username, auth_method, mitid_identity):

        cache_key = f"{mitid_username}:{auth_method}:{mitid_identity or 1}"
        self._sessions.pop(cache_key, None)
        self._auth_jobs.pop(cache_key, None)
        return True

    def _tokens_valid(self, client):
        try:
            check = client.check_token_expiration()
            return bool(check.get("valid"))
        except Exception:
            return False

    def _refresh_tokens(self, client):
        try:
            if client.renew_access_token():
                self._apply_access_token(client, client.tokens)
                return True
        except Exception:
            return False
        return False

    def _apply_access_token(self, client, tokens):
        access_token = tokens["access_token"]
        client.tokens = tokens
        client.session.headers.update({"Authorization": f"Bearer {access_token}"})
        try:
            client.session.get("https://www.aula.dk/portal", timeout=30)
        except Exception:
            pass
        # Touch the API to establish csrf token cookies.
        self._get_json(
            client.session,
            "profiles.getProfilesByLogin",
            {"access_token": access_token},
        )
        self._get_json(
            client.session,
            "profiles.getProfileContext",
            {"portalrole": "guardian", "access_token": access_token},
        )

    def _discover_api_base(self, session, access_token):
        for offset in range(MAX_API_BUMP + 1):
            version = DEFAULT_API_VERSION + offset
            base = f"https://www.aula.dk/api/v{version}/"
            url = (
                f"{base}?method=profiles.getProfilesByLogin"
                f"&access_token={access_token}"
            )
            response = session.get(url, timeout=30)
            if response.status_code == 410:
                continue
            if response.status_code == 200:
                return base
            if response.status_code == 403:
                raise AulaServiceError(f"Aula API error 403: {response.text[:300]}")
        return f"https://www.aula.dk/api/v{DEFAULT_API_VERSION}/"

    def _get_json(self, session, method, params=None, base_url=None):
        params = params or {}
        base = base_url or f"https://www.aula.dk/api/v{DEFAULT_API_VERSION}/"
        url = base + "?method=" + method
        for key, value in params.items():
            url += f"&{key}={value}"
        self._log(f"[AULA] GET {url}", level="verbose")
        response = session.get(url, timeout=30)
        if response.status_code != 200:
            detail = response.text.strip()
            self._log(f"[AULA] GET {url} -> {response.status_code}")
            self._log(f"[AULA] Response: {detail}", level="verbose")
            raise AulaServiceError(f"Aula API error {response.status_code}")
        return response.json()

    def _post_json(self, session, method, payload, params=None, base_url=None):
        params = params or {}
        base = base_url or f"https://www.aula.dk/api/v{DEFAULT_API_VERSION}/"
        url = base + "?method=" + method
        for key, value in params.items():
            url += f"&{key}={value}"
        csrf_token = session.cookies.get("Csrfp-Token")
        headers = {
            "csrfp-token": csrf_token or "",
            "content-type": "application/json",
            "accept": "application/json, text/plain, */*",
            "origin": "https://www.aula.dk",
            "referer": "https://www.aula.dk/",
            "x-requested-with": "XMLHttpRequest",
        }
        self._log(f"[AULA] POST {url}", level="verbose")
        self._log(f"[AULA] Headers: {headers}", level="verbose")
        self._log(f"[AULA] Payload: {payload}", level="verbose")
        response = session.post(
            url, data=json.dumps(payload), headers=headers, timeout=30
        )
        if response.status_code != 200:
            detail = response.text.strip()[:300]
            self._log(f"[AULA] POST {url} -> {response.status_code}")
            self._log(f"[AULA] Response: {response.text.strip()}", level="verbose")
            raise AulaServiceError(
                f"Aula API error {response.status_code} ({base}): {detail}"
            )
        return response.json()

    def get_profiles(self, session_data):
        access_token = session_data["tokens"]["access_token"]
        return self._get_json(
            session_data["client"].session,
            "profiles.getProfilesByLogin",
            {"access_token": access_token},
            base_url=session_data.get("api_base"),
        )

    def get_calendar_events(self, session_data, start, end, child_ids):
        access_token = session_data["tokens"]["access_token"]
        normalized_ids = []
        for child_id in child_ids:
            try:
                normalized_ids.append(int(child_id))
            except (TypeError, ValueError):
                continue
        self._log(f"[AULA] Calendar instProfileIds: {normalized_ids}")
        start_dt = parse_api_datetime(start)
        end_dt = parse_api_datetime(end)
        chunk = dt.timedelta(days=14)
        combined = {"data": []}
        cursor = start_dt
        while cursor <= end_dt:
            chunk_end = min(cursor + chunk, end_dt)
            payload = {
                "instProfileIds": normalized_ids,
                "resourceIds": [],
                "start": cursor.strftime("%Y-%m-%d 00:00:00.0000%z"),
                "end": chunk_end.strftime("%Y-%m-%d 23:59:59.0000%z"),
            }
            self._log(
                f"[AULA] Calendar range {payload['start']} -> {payload['end']}",
                level="verbose",
            )
            response = self._post_json(
                session_data["client"].session,
                "calendar.getEventsByProfileIdsAndResourceIds",
                payload,
                {"access_token": access_token},
                base_url=session_data.get("api_base"),
            )
            data = response.get("data")
            if isinstance(data, list):
                self._log(f"[AULA] Calendar batch size: {len(data)}")
                if data:
                    self._log(
                        f"[AULA] Calendar item keys: {list(data[0].keys())}",
                        level="verbose",
                    )
                combined["data"].extend(data)
            else:
                self._log("[AULA] Calendar batch had no list data.")
            cursor = chunk_end + dt.timedelta(days=1)
        self._log(f"[AULA] Calendar total items: {len(combined['data'])}")
        return combined


def parse_date(value):
    if not value:
        return None
    if isinstance(value, dt.datetime):
        return value
    text = str(value).replace("Z", "+00:00")
    try:
        return dt.datetime.fromisoformat(text)
    except ValueError:
        return dt.datetime.strptime(text, "%Y-%m-%d")


def build_range(months=None, start=None, end=None):
    if start and end:
        start_dt = parse_date(start)
        end_dt = parse_date(end)
    else:
        months = months or 6
        end_dt = dt.datetime.now(dt.timezone.utc)
        start_dt = end_dt - dt.timedelta(days=30 * months)
    start_fmt = start_dt.strftime("%Y-%m-%d 00:00:00.0000%z")
    end_fmt = end_dt.strftime("%Y-%m-%d 23:59:59.0000%z")
    return start_fmt, end_fmt


def parse_api_datetime(value):
    if isinstance(value, dt.datetime):
        return value
    return dt.datetime.strptime(value, "%Y-%m-%d %H:%M:%S.%f%z")


def extract_children(profile_response, debug=False, debug_level="info"):
    children = []
    profiles = profile_response.get("data", {}).get("profiles", [])
    for profile in profiles:
        for child in profile.get("children", []):
            institution = child.get("institutionProfile", {}) or {}
            class_group = child.get("classGroup", {}) or {}
            if debug and debug_level == "verbose":
                child_keys = sorted(child.keys())
                inst_keys = sorted(institution.keys())
                print(f"[AULA] Child keys: {child_keys}")
                print(f"[AULA] Institution keys: {inst_keys}")
            if debug:
                print(
                    "[AULA] Child ids: "
                    f"id={child.get('id')} "
                    f"profileId={child.get('profileId')} "
                    f"instProfileId={institution.get('id')}"
                )
            children.append(
                {
                    "id": str(child.get("id")),
                    "instProfileId": str(
                        institution.get("id") or child.get("institutionProfileId") or ""
                    ),
                    "profileId": str(child.get("profileId") or ""),
                    "userId": str(child.get("userId", "")),
                    "name": child.get("name"),
                    "className": class_group.get("name")
                    or institution.get("className")
                    or "",
                    "institutionName": institution.get("institutionName", ""),
                }
            )
    return children


def extract_events(calendar_response):
    data = calendar_response.get("data")
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for key in ("events", "calendarEvents", "items", "calendars"):
            if key in data and isinstance(data[key], list):
                return data[key]
    if os.environ.get("AULA_DEBUG") and os.environ.get("AULA_DEBUG_LEVEL", "info").lower() == "verbose":
        print(f"[AULA] Calendar response keys: {list(calendar_response.keys())}")
        print(f"[AULA] Calendar data type: {type(data)}")
    return []


def event_to_lesson(event, default_child_id=""):
    if event.get("type") and event.get("type") != "lesson":
        return None
    title = (event.get("title") or event.get("summary") or "").strip()
    start_raw = (
        event.get("startDateTime") or event.get("start") or event.get("startDate")
    )
    end_raw = event.get("endDateTime") or event.get("end") or event.get("endDate")
    start_dt = parse_date(start_raw) if start_raw else None
    end_dt = parse_date(end_raw) if end_raw else None

    lesson_info = event.get("lesson", {}) or {}
    participants = lesson_info.get("participants", []) or []
    substitute_flag = any(
        participant.get("participantRole") == "substituteTeacher"
        for participant in participants
    )
    teacher_name = ""
    if substitute_flag:
        substitute = next(
            (
                p
                for p in participants
                if p.get("participantRole") == "substituteTeacher"
            ),
            {},
        )
        teacher_name = substitute.get("teacherName") or substitute.get(
            "teacherInitials", ""
        )
    if not teacher_name and participants:
        first = participants[0]
        teacher_name = first.get("teacherInitials") or first.get("teacherName", "")

    substitute_flag = substitute_flag or any(
        [
            event.get("isSubstitute"),
            event.get("substitute"),
            event.get("isSubstitution"),
            event.get("substitution"),
            "vikar" in title.lower(),
            "substitute" in title.lower(),
        ]
    )

    subject = (
        lesson_info.get("subject")
        or lesson_info.get("subjectName")
        or event.get("subject")
        or title
        or "Lesson"
    )

    return {
        "id": str(event.get("id") or event.get("eventId") or event.get("uuid") or ""),
        "date": start_dt.date().isoformat() if start_dt else "",
        "startTime": start_dt.strftime("%H:%M") if start_dt else "",
        "endTime": end_dt.strftime("%H:%M") if end_dt else "",
        "subject": subject,
        "teacher": teacher_name
        or event.get("teacherName")
        or event.get("teacher")
        or event.get("owner", {}).get("name")
        or "",
        "substitute": bool(substitute_flag),
        "class": event.get("className") or event.get("class") or "",
        "childId": str(
            event.get("childId")
            or event.get("profileId")
            or event.get("instProfileId")
            or default_child_id
        ),
    }


def extract_lessons(calendar_response, children):
    events = extract_events(calendar_response)
    children_by_id = {child["id"]: child for child in children}
    children_by_profile = {
        child.get("profileId"): child for child in children if child.get("profileId")
    }
    children_by_inst = {
        child.get("instProfileId"): child
        for child in children
        if child.get("instProfileId")
    }
    lessons = []
    for event in events:
        belongs = event.get("belongsToProfiles") or []
        child_id = str(
            (belongs[0] if belongs else "")
            or event.get("childId")
            or event.get("profileId")
            or event.get("instProfileId")
            or ""
        )
        if not child_id and children:
            child_id = children[0]["id"]
        lesson = event_to_lesson(event, default_child_id=child_id)
        if lesson is None:
            continue
        if not lesson["class"]:
            match = (
                children_by_id.get(lesson["childId"])
                or children_by_profile.get(lesson["childId"])
                or children_by_inst.get(lesson["childId"])
            )
            if match:
                lesson["class"] = match.get("className", "")
        if not lesson["id"]:
            lesson["id"] = f"{lesson['childId']}_{lesson['date']}_{lesson['startTime']}"
        lessons.append(lesson)
    return lessons
