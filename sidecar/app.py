import os
from flask import Flask, jsonify, request

from aula_service import (
    AulaService,
    AulaServiceError,
    build_range,
    extract_children,
    extract_lessons,
)


app = Flask(__name__)
service = AulaService()


def get_payload():
    return request.get_json(force=True, silent=True) or {}


def normalize_auth(payload):
    session_key = payload.get("session_key") or payload.get("sessionKey")
    return {
        "session_key": session_key,
        "mitid_username": payload.get("mitid_username") or payload.get("aulaUsername"),
        "mitid_password": payload.get("mitid_password")
        or payload.get("aulaPassword")
        or "",
        "auth_method": payload.get("auth_method") or payload.get("authMethod") or "APP",
        "mitid_identity": int(payload.get("mitid_identity") or payload.get("mitidIdentity") or 1),
    }


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"ok": True})


@app.route("/api/profile", methods=["POST"])
def profile():
    payload = get_payload()
    auth = normalize_auth(payload)
    if not auth["session_key"] and not auth["mitid_username"]:
        return jsonify({"error": "mitid_username required"}), 400
    try:
        if auth["session_key"]:
            status = service.ensure_session_by_handle(auth["session_key"])
        else:
            status = service.ensure_session(**auth)
        if status["status"] != "ready":
            return jsonify(status)
        profile_response = service.get_profiles(status["session"])
        children = extract_children(
            profile_response, debug=service._debug, debug_level=service._debug_level
        )
        session_handle = status.get("session_handle")
        session_expires_at = status.get("session_expires_at")
        return jsonify(
            {
                "status": "ready",
                "children": children,
                "sessionKey": session_handle,
                "sessionExpiresAt": session_expires_at,
            }
        )
    except AulaServiceError as error:
        return jsonify({"error": str(error)}), 400


@app.route("/api/lessons", methods=["POST"])
def lessons():
    payload = get_payload()
    auth = normalize_auth(payload)
    if not auth["session_key"] and not auth["mitid_username"]:
        return jsonify({"error": "mitid_username required"}), 400
    try:
        if auth["session_key"]:
            status = service.ensure_session_by_handle(auth["session_key"])
        else:
            status = service.ensure_session(**auth)
        if status["status"] != "ready":
            return jsonify(status)
        profile_response = service.get_profiles(status["session"])
        children = extract_children(
            profile_response, debug=service._debug, debug_level=service._debug_level
        )
        child_ids = payload.get("childIds") or [
            child.get("profileId") or child.get("instProfileId") or child["id"]
            for child in children
        ]
        start, end = build_range(
            months=payload.get("months"),
            start=payload.get("start"),
            end=payload.get("end"),
        )
        calendar_response = service.get_calendar_events(
            status["session"], start, end, child_ids
        )
        lessons = extract_lessons(calendar_response, children)
        if child_ids:
            lessons = [lesson for lesson in lessons if lesson["childId"] in child_ids]
        return jsonify({"status": "ready", "lessons": lessons})
    except AulaServiceError as error:
        return jsonify({"error": str(error)}), 400


@app.route("/api/auth/status", methods=["POST"])
def auth_status():
    payload = get_payload()
    auth = normalize_auth(payload)
    if not auth["mitid_username"]:
        return jsonify({"error": "mitid_username required"}), 400
    try:
        status = service.ensure_session(**auth)
        if status["status"] == "ready":
            return jsonify({"status": "ready"})
        return jsonify(status)
    except AulaServiceError as error:
        return jsonify({"status": "error", "error": str(error)}), 400


@app.route("/api/auth/reset", methods=["POST"])
def auth_reset():
    payload = get_payload()
    auth = normalize_auth(payload)
    if not auth["mitid_username"]:
        return jsonify({"error": "mitid_username required"}), 400
    service.reset_session(
        auth["mitid_username"], auth["auth_method"], auth["mitid_identity"]
    )
    return jsonify({"ok": True})


if __name__ == "__main__":
    port = int(os.environ.get("AULA_SIDECAR_PORT", "5042"))
    app.run(host="0.0.0.0", port=port)
