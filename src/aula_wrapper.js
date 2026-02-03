const SIDECAR_URL = process.env.AULA_SIDECAR_URL || "";
const USE_STUB = process.env.AULA_USE_STUB === "1" || !SIDECAR_URL;

async function postJson(path, body) {
  const response = await fetch(`${SIDECAR_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Sidecar request failed");
  }
  return payload;
}

function stubProfile({ aulaUsername }) {
  const childSeed = aulaUsername?.split("@")[0] || "Parent";
  return {
    children: [
      { id: `child_${childSeed}_1`, name: "Ida Jensen", className: "5A" },
      { id: `child_${childSeed}_2`, name: "Mads Jensen", className: "2B" },
    ],
  };
}

function stubLessons({ months = 6, children }) {
  const end = new Date();
  const start = new Date();
  start.setMonth(start.getMonth() - months);
  const lessons = [];
  children.forEach((child) => {
    let cursor = new Date(start);
    while (cursor <= end) {
      if (cursor.getDay() >= 1 && cursor.getDay() <= 5) {
        const lessonCount = 4 + (cursor.getDay() % 2);
        for (let i = 0; i < lessonCount; i += 1) {
          lessons.push({
            id: `${child.id}_${cursor.toISOString().slice(0, 10)}_${i}`,
            date: cursor.toISOString().slice(0, 10),
            startTime: `${8 + i}:00`,
            endTime: `${9 + i}:00`,
            subject: "Lesson",
            teacher: "Teacher",
            substitute: i % 5 === 0,
            class: child.className,
            childId: child.id,
          });
        }
      }
      cursor.setDate(cursor.getDate() + 1);
    }
  });
  return lessons;
}

function buildAuthPayload({ aulaUsername, aulaPassword }) {
  return {
    mitid_username: aulaUsername,
    mitid_password: aulaPassword,
    auth_method: process.env.AULA_AUTH_METHOD || "APP",
    mitid_identity: parseInt(process.env.AULA_MITID_IDENTITY || "1", 10),
  };
}

export async function fetchAulaProfile({ aulaUsername, aulaPassword }) {
  if (USE_STUB) return stubProfile({ aulaUsername });
  const payload = await postJson(
    "/api/profile",
    buildAuthPayload({ aulaUsername, aulaPassword })
  );
  return payload;
}

export async function fetchAulaLessons({ months = 6, children, credentials }) {
  if (USE_STUB) return stubLessons({ months, children });
  const payload = await postJson("/api/lessons", {
    ...buildAuthPayload(credentials),
    months,
    childIds: children.map((child) => child.id),
  });
  return payload;
}

export async function fetchAulaAuthStatus({ aulaUsername, aulaPassword }) {
  if (USE_STUB) return { status: "ready" };
  return postJson(
    "/api/auth/status",
    buildAuthPayload({ aulaUsername, aulaPassword })
  );
}

export async function fetchAulaAuthReset({ aulaUsername, aulaPassword }) {
  if (USE_STUB) return { ok: true };
  return postJson(
    "/api/auth/reset",
    buildAuthPayload({ aulaUsername, aulaPassword })
  );
}
