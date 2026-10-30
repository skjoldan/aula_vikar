// SPDX-License-Identifier: GPL-3.0-only
const state = {
  token: sessionStorage.getItem("aula_token"),
  children: [],
  sessionId: null,
  revision: 0,
};

const elements = {
  sessionStatus: document.getElementById("sessionStatus"),
  startLoginButton: document.getElementById("startLoginButton"),
  loginHint: document.getElementById("loginHint"),
  callbackSection: document.getElementById("callbackSection"),
  callbackUrl: document.getElementById("callbackUrl"),
  completeLoginButton: document.getElementById("completeLoginButton"),
  syncButton: document.getElementById("syncButton"),
  syncHint: document.getElementById("syncHint"),
  metricsCards: document.getElementById("metricsCards"),
  subjectBars: document.getElementById("subjectBars"),
  monthBars: document.getElementById("monthBars"),
  streakInfo: document.getElementById("streakInfo"),
  childSelect: document.getElementById("childSelect"),
  logoutButton: document.getElementById("logoutButton"),
};

function setHint(element, message, isError = false) {
  element.textContent = message;
  element.style.color = isError ? "#b0342b" : "#d16b3a";
}

function selectedLevel() {
  return document.querySelector('input[name="level"]:checked')?.value || "3";
}

async function apiFetch(path, options = {}) {
  const revision = state.revision;
  const headers = options.headers ? { ...options.headers } : {};
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const res = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...headers },
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && revision === state.revision) resetSession();
    throw new Error(payload.error || "Request failed");
  }
  return payload;
}

function updateSessionStatus(label) {
  elements.sessionStatus.textContent = label || "Signed out";
}

function renderChildSelector(children) {
  elements.childSelect.innerHTML = "";
  const allOption = document.createElement("option");
  allOption.value = "";
  allOption.textContent = "All children";
  elements.childSelect.appendChild(allOption);
  children.forEach((child) => {
    const option = document.createElement("option");
    option.value = child.id;
    option.textContent = `${child.name} (${child.className})`;
    elements.childSelect.appendChild(option);
  });
}

function makeMetricCard(label, value) {
  const div = document.createElement("div");
  div.className = "metric-card";
  const p = document.createElement("p");
  p.className = "muted";
  p.textContent = label;
  const val = document.createElement("div");
  val.className = "metric-value";
  val.textContent = value;
  div.appendChild(p);
  div.appendChild(val);
  return div;
}

function makeBarRow(label, percent) {
  const row = document.createElement("div");
  row.className = "bar";

  const left = document.createElement("div");
  const labelEl = document.createElement("div");
  labelEl.className = "muted";
  labelEl.textContent = label;
  const track = document.createElement("div");
  track.className = "bar-track";
  const fill = document.createElement("div");
  fill.className = "bar-fill";
  fill.style.width = `${percent}%`;
  track.appendChild(fill);
  left.appendChild(labelEl);
  left.appendChild(track);

  const right = document.createElement("strong");
  right.textContent = `${percent}%`;

  row.appendChild(left);
  row.appendChild(right);
  return row;
}

function renderMetrics(metrics) {
  elements.metricsCards.innerHTML = "";
  elements.subjectBars.innerHTML = "";
  elements.monthBars.innerHTML = "";
  elements.streakInfo.textContent = "";
  if (!metrics) return;
  [
    { label: "Total lessons", value: metrics.totalLessons },
    { label: "Substitute lessons", value: metrics.substituteLessons },
    { label: "Substitute %", value: `${metrics.substitutePercent}%` },
    { label: "Longest streak", value: metrics.longestSubstituteStreak.lessons },
  ].forEach(({ label, value }) => {
    elements.metricsCards.appendChild(makeMetricCard(label, value));
  });

  elements.subjectBars.innerHTML = "";
  metrics.perSubject.forEach((item) => {
    elements.subjectBars.appendChild(makeBarRow(item.subject, item.substitutePercent));
  });

  elements.monthBars.innerHTML = "";
  metrics.perMonth.forEach((item) => {
    elements.monthBars.appendChild(makeBarRow(item.month, item.substitutePercent));
  });

  elements.streakInfo.innerHTML = "";
  const streak = metrics.longestSubstituteStreak;
  if (streak.range) {
    const strong = document.createElement("strong");
    strong.textContent = `${streak.lessons} lessons`;
    elements.streakInfo.appendChild(strong);
    elements.streakInfo.appendChild(
      document.createTextNode(` from ${streak.range.start} to ${streak.range.end}`)
    );
  } else {
    elements.streakInfo.textContent = "No substitute streaks yet.";
  }
}

async function refreshMetrics() {
  const revision = state.revision;
  const childId = elements.childSelect.value || "";
  const query = childId ? `?childId=${encodeURIComponent(childId)}` : "";
  const { metrics } = await apiFetch(`/api/metrics${query}`);
  if (revision !== state.revision) return;
  renderMetrics(metrics);
}

function resetSession() {
  state.revision += 1;
  state.token = null;
  state.children = [];
  state.sessionId = null;
  sessionStorage.removeItem("aula_token");
  elements.childSelect.innerHTML = "";
  elements.callbackSection.style.display = "none";
  elements.callbackUrl.value = "";
  renderMetrics(null);
  setHint(elements.loginHint, "");
  setHint(elements.syncHint, "");
  updateSessionStatus();
}

// Step 1: get auth URL from backend, open it in a new tab
elements.startLoginButton.addEventListener("click", async () => {
  const revision = state.revision;
  setHint(elements.loginHint, "Loading...");
  try {
    const { authUrl, sessionId } = await apiFetch(
      `/api/auth/start?level=${selectedLevel()}`
    );
    if (revision !== state.revision) return;
    state.sessionId = sessionId;
    window.open(authUrl, "_blank");
    elements.callbackSection.style.display = "block";
    setHint(
      elements.loginHint,
      "Sign in, then copy the full address from Aula's Fortsæt login page and paste it below. You do not need to click Fortsæt login."
    );
  } catch (error) {
    if (revision !== state.revision) return;
    setHint(elements.loginHint, error.message, true);
  }
});

// Step 2: user pastes the callback URL after signing in
elements.completeLoginButton.addEventListener("click", async () => {
  const revision = state.revision;
  const callbackUrl = elements.callbackUrl.value.trim();
  if (!callbackUrl) {
    setHint(elements.loginHint, "Paste the URL from your browser first.", true);
    return;
  }
  setHint(elements.loginHint, "Completing login...");
  try {
    const { token, children } = await apiFetch("/api/auth/callback", {
      method: "POST",
      body: JSON.stringify({ callbackUrl, sessionId: state.sessionId }),
    });
    if (revision !== state.revision) return;
    resetSession();
    state.token = token;
    sessionStorage.setItem("aula_token", token);
    state.children = children;
    elements.callbackSection.style.display = "none";
    elements.callbackUrl.value = "";
    state.sessionId = null;
    renderChildSelector(children);
    updateSessionStatus("Signed in");
    setHint(elements.loginHint, "Connected. Sync lessons to see your dashboard.");
  } catch (error) {
    if (revision !== state.revision) return;
    setHint(elements.loginHint, error.message, true);
  }
});

elements.syncButton.addEventListener("click", async () => {
  const revision = state.revision;
  setHint(elements.syncHint, "Syncing lessons...");
  try {
    const { synced } = await apiFetch("/api/aula/sync", {
      method: "POST",
      body: JSON.stringify({ months: 6 }),
    });
    if (revision !== state.revision) return;
    setHint(elements.syncHint, `Synced ${synced} lessons.`);
    await refreshMetrics();
  } catch (error) {
    if (revision !== state.revision) return;
    setHint(elements.syncHint, error.message, true);
  }
});

elements.childSelect.addEventListener("change", () => {
  refreshMetrics().catch(() => {});
});

elements.logoutButton.addEventListener("click", async () => {
  // Capture the authenticated request, then clear private UI immediately.
  const logout = state.token ? apiFetch("/api/logout", { method: "POST" }) : Promise.resolve();
  resetSession();
  setHint(elements.loginHint, "Signed out.");
  try {
    await logout;
  } catch {}
});

async function bootstrap() {
  if (!state.token) return;
  const revision = state.revision;
  try {
    const { children } = await apiFetch("/api/session");
    if (revision !== state.revision) return;
    state.children = children;
    renderChildSelector(children);
    updateSessionStatus("Signed in");
    await refreshMetrics();
  } catch {
    if (revision === state.revision) resetSession();
  }
}

bootstrap();
