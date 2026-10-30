// SPDX-License-Identifier: GPL-3.0-only
// Direct Aula REST API client — no Python sidecar needed.
// Authentication: access token passed as ?access_token= query param (NOT Bearer header).
// CSRF: token read from cookies, sent as csrfp-token request header.

const API_VERSION_START = 23;
const API_VERSION_MAX = 28;

function parseSetCookies(headers) {
  const cookies = {};
  const list =
    typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
  for (const header of list) {
    const semi = header.indexOf(";");
    const pair = semi === -1 ? header : header.slice(0, semi);
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    cookies[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  return cookies;
}

function cookieHeader(cookies) {
  return Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

async function aulaGet(url, accessToken, cookies = {}) {
  const sep = url.includes("?") ? "&" : "?";
  const fullUrl = `${url}${sep}access_token=${encodeURIComponent(accessToken)}`;
  const headers = {};
  if (Object.keys(cookies).length) headers["Cookie"] = cookieHeader(cookies);

  const res = await fetch(fullUrl, { headers, redirect: "follow" });
  const newCookies = { ...cookies, ...parseSetCookies(res.headers) };
  if (!res.ok) throw new Error(`Aula API ${res.status} GET ${url}`);
  return { json: await res.json(), cookies: newCookies };
}

async function aulaPost(url, body, accessToken, cookies = {}) {
  const sep = url.includes("?") ? "&" : "?";
  const fullUrl = `${url}${sep}access_token=${encodeURIComponent(accessToken)}`;
  const headers = {
    "Content-Type": "application/json",
    "Accept": "application/json, text/plain, */*",
    "Origin": "https://www.aula.dk",
    "Referer": "https://www.aula.dk/",
    "X-Requested-With": "XMLHttpRequest",
    "csrfp-token": cookies["Csrfp-Token"] || "",
  };
  if (Object.keys(cookies).length) headers["Cookie"] = cookieHeader(cookies);

  const res = await fetch(fullUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    redirect: "follow",
  });
  const newCookies = { ...cookies, ...parseSetCookies(res.headers) };
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Aula API ${res.status} POST ${url}: ${text.slice(0, 200)}`);
  }
  return { json: await res.json(), cookies: newCookies };
}

async function discoverApiBase(accessToken) {
  for (let v = API_VERSION_START; v <= API_VERSION_MAX; v++) {
    const base = `https://www.aula.dk/api/v${v}/`;
    const url = `${base}?method=profiles.getProfilesByLogin&access_token=${encodeURIComponent(accessToken)}`;
    const res = await fetch(url, { redirect: "follow" });
    if (res.status === 410) continue;
    if (res.status === 200) return base;
    if (res.status === 403)
      throw new Error("Aula returned 403 — access token may be invalid");
  }
  return `https://www.aula.dk/api/v${API_VERSION_START}/`;
}

// Call after OIDC token exchange. Returns apiBase, cookies, and children.
export async function initAulaSession(accessToken) {
  const apiBase = await discoverApiBase(accessToken);
  let cookies = {};

  // getProfilesByLogin establishes CSRF cookies and returns profile/children data
  const { json: profileJson, cookies: c1 } = await aulaGet(
    `${apiBase}?method=profiles.getProfilesByLogin`,
    accessToken,
    cookies
  );
  cookies = c1;

  // getProfileContext is required to finish server-side session initialization
  const { cookies: c2 } = await aulaGet(
    `${apiBase}?method=profiles.getProfileContext&portalrole=guardian`,
    accessToken,
    cookies
  );
  cookies = c2;

  return { apiBase, cookies, children: extractChildren(profileJson) };
}

function extractChildren(profileJson) {
  const children = [];
  const profiles = profileJson?.data?.profiles ?? [];
  for (const profile of profiles) {
    for (const child of profile.children ?? []) {
      const inst = child.institutionProfile ?? {};
      const classGroup = child.classGroup ?? {};
      children.push({
        id: String(child.id ?? ""),
        instProfileId: String(inst.id ?? child.institutionProfileId ?? ""),
        profileId: String(child.profileId ?? ""),
        name: child.name ?? "",
        className: classGroup.name ?? inst.className ?? "",
        institutionName: inst.institutionName ?? "",
      });
    }
  }
  return children;
}

export async function fetchLessons({
  apiBase,
  cookies,
  accessToken,
  children,
  months = 6,
}) {
  const now = new Date();
  const start = new Date(now);
  start.setMonth(start.getMonth() - months);

  const instIds = children
    .map((c) => parseInt(c.instProfileId || c.id, 10))
    .filter((n) => !isNaN(n));

  const allEvents = [];
  let liveCookies = { ...cookies };
  let cursor = new Date(start);

  while (cursor <= now) {
    const chunkEnd = new Date(
      Math.min(cursor.getTime() + 14 * 86_400_000, now.getTime())
    );
    const payload = {
      instProfileIds: instIds,
      resourceIds: [],
      start: fmtDate(cursor, false),
      end: fmtDate(chunkEnd, true),
    };
    const { json, cookies: nc } = await aulaPost(
      `${apiBase}?method=calendar.getEventsByProfileIdsAndResourceIds`,
      payload,
      accessToken,
      liveCookies
    );
    liveCookies = nc;
    const events = Array.isArray(json?.data) ? json.data : [];
    allEvents.push(...events);
    cursor = new Date(chunkEnd.getTime() + 86_400_000);
  }

  return eventsToLessons(allEvents, children);
}

function fmtDate(d, endOfDay) {
  const p = (n) => String(n).padStart(2, "0");
  const y = d.getUTCFullYear();
  const mo = p(d.getUTCMonth() + 1);
  const day = p(d.getUTCDate());
  return `${y}-${mo}-${day} ${endOfDay ? "23:59:59" : "00:00:00"}.0000+0000`;
}

function parseIso(v) {
  if (!v) return null;
  const text = String(v);
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2}))?$/.exec(text);
  if (!match) return null;
  const [, year, month, day, hour = "0", minute = "0", second = "0"] = match;
  const calendarDay = new Date(`${year}-${month}-${day}T00:00:00Z`);
  if (!Number.isFinite(calendarDay.getTime()) ||
      calendarDay.toISOString().slice(0, 10) !== `${year}-${month}-${day}` ||
      Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return null;
  const parsed = new Date(text);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

const schoolTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Copenhagen",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

function localLessonTime(dt) {
  const parts = Object.fromEntries(schoolTime.formatToParts(dt).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

export function eventsToLessons(events, children) {
  const byId = Object.fromEntries(children.map((c) => [c.id, c]));
  const byInst = Object.fromEntries(children.map((c) => [c.instProfileId, c]));
  const byProfile = Object.fromEntries(children.map((c) => [c.profileId, c]));

  const lessons = [];
  const seen = new Set();
  for (const ev of events) {
    if (ev.type && ev.type !== "lesson") continue;

    const title = (ev.title ?? ev.summary ?? "").trim();
    const startDt = parseIso(ev.startDateTime ?? ev.start ?? ev.startDate);
    const endDt = parseIso(ev.endDateTime ?? ev.end ?? ev.endDate);
    // Invalid or missing timestamps cannot safely contribute to statistics.
    if (!startDt || !endDt || endDt <= startDt) continue;
    const start = localLessonTime(startDt);
    const end = localLessonTime(endDt);
    const lessonInfo = ev.lesson ?? {};
    const participants = lessonInfo.participants ?? [];

    const subByRole = participants.some(
      (p) => p.participantRole === "substituteTeacher"
    );
    const subByField = !!(
      ev.isSubstitute ||
      ev.substitute ||
      ev.isSubstitution ||
      ev.substitution
    );
    const subByTitle =
      title.toLowerCase().includes("vikar") ||
      title.toLowerCase().includes("substitute");
    const substitute = subByRole || subByField || subByTitle;

    let teacher = "";
    if (subByRole) {
      const sub =
        participants.find((p) => p.participantRole === "substituteTeacher") ??
        {};
      teacher = sub.teacherName ?? sub.teacherInitials ?? "";
    }
    if (!teacher && participants.length > 0) {
      teacher =
        participants[0].teacherInitials ?? participants[0].teacherName ?? "";
    }
    teacher =
      teacher || ev.teacherName || ev.teacher || ev.owner?.name || "";

    const subject =
      lessonInfo.subject ??
      lessonInfo.subjectName ??
      ev.subject ??
      title ??
      "Lesson";

    const belongs = ev.belongsToProfiles ?? [];
    const profileIds = (belongs.length ? belongs : [ev.childId, ev.profileId, ev.instProfileId])
      .filter((id) => id !== undefined && id !== null && id !== "").map(String);
    const matched = new Map();
    for (const profileId of profileIds) {
      const child = byId[profileId] ?? byProfile[profileId] ?? byInst[profileId];
      if (child) matched.set(child.id, child);
    }
    // An event without attribution is unambiguous only for a single child.
    if (!profileIds.length && children.length === 1) matched.set(children[0].id, children[0]);

    for (const child of matched.values()) {
      const id = String(ev.id ?? ev.eventId ?? ev.uuid ?? `${child.id}_${start.date}_${start.time}_${subject}`);
      const key = JSON.stringify([child.id, id, start.date, start.time]);
      if (seen.has(key)) continue;
      seen.add(key);
      lessons.push({
        id,
        date: start.date,
        startTime: start.time,
        endTime: end.time,
        subject,
        teacher,
        substitute,
        class: ev.className ?? ev.class ?? child.className ?? "",
        childId: child.id,
      });
    }
  }
  return lessons;
}
