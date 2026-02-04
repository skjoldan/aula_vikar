const state = {
  token: localStorage.getItem("aula_token"),
  children: [],
  metrics: null,
  connectToken: null,
};

const elements = {
  sessionStatus: document.getElementById("sessionStatus"),
  connectForm: document.getElementById("connectForm"),
  connectHint: document.getElementById("connectHint"),
  syncButton: document.getElementById("syncButton"),
  syncHint: document.getElementById("syncHint"),
  metricsCards: document.getElementById("metricsCards"),
  subjectBars: document.getElementById("subjectBars"),
  monthBars: document.getElementById("monthBars"),
  streakInfo: document.getElementById("streakInfo"),
  childSelect: document.getElementById("childSelect"),
  logoutButton: document.getElementById("logoutButton"),
  deleteButton: document.getElementById("deleteButton"),
  deleteHint: document.getElementById("deleteHint"),
  mitidCard: document.getElementById("mitidCard"),
  mitidStatus: document.getElementById("mitidStatus"),
  mitidOtp: document.getElementById("mitidOtp"),
  qrLeft: document.getElementById("qrLeft"),
  qrRight: document.getElementById("qrRight"),
  resetMitidButton: document.getElementById("resetMitidButton"),
};

function setHint(element, message, isError = false) {
  element.textContent = message;
  element.style.color = isError ? "#b0342b" : "#d16b3a";
}

async function apiFetch(path, options = {}) {
  const headers = options.headers ? { ...options.headers } : {};
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...headers },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = payload.error || "Request failed";
    throw new Error(error);
  }
  return payload;
}

function updateSessionStatus(userEmail) {
  elements.sessionStatus.textContent = userEmail || "Signed out";
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

function renderMetrics(metrics) {
  if (!metrics) return;
  elements.metricsCards.innerHTML = "";
  const cards = [
    { label: "Total lessons", value: metrics.totalLessons },
    { label: "Substitute lessons", value: metrics.substituteLessons },
    { label: "Substitute %", value: `${metrics.substitutePercent}%` },
    { label: "Longest streak", value: metrics.longestSubstituteStreak.lessons },
  ];
  cards.forEach((card) => {
    const div = document.createElement("div");
    div.className = "metric-card";
    div.innerHTML = `<p class="muted">${card.label}</p><div class="metric-value">${card.value}</div>`;
    elements.metricsCards.appendChild(div);
  });

  elements.subjectBars.innerHTML = "";
  metrics.perSubject.forEach((item) => {
    const row = document.createElement("div");
    row.className = "bar";
    row.innerHTML = `
      <div>
        <div class="muted">${item.subject}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${item.substitutePercent}%"></div></div>
      </div>
      <strong>${item.substitutePercent}%</strong>
    `;
    elements.subjectBars.appendChild(row);
  });

  elements.monthBars.innerHTML = "";
  metrics.perMonth.forEach((item) => {
    const row = document.createElement("div");
    row.className = "bar";
    row.innerHTML = `
      <div>
        <div class="muted">${item.month}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${item.substitutePercent}%"></div></div>
      </div>
      <strong>${item.substitutePercent}%</strong>
    `;
    elements.monthBars.appendChild(row);
  });

  const streak = metrics.longestSubstituteStreak;
  elements.streakInfo.innerHTML = streak.range
    ? `<strong>${streak.lessons} lessons</strong> from ${streak.range.start} to ${streak.range.end}`
    : "No substitute streaks yet.";
}

async function refreshChildren() {
  try {
    const { children } = await apiFetch("/api/children");
    state.children = children;
    renderChildSelector(children);
  } catch (error) {
    setHint(elements.connectHint, error.message, true);
  }
}

let mitidPollTimer = null;
let qrFrame = 0;

function stopMitidPolling() {
  if (mitidPollTimer) {
    clearInterval(mitidPollTimer);
    mitidPollTimer = null;
  }
}



function renderMitidStatus(payload) {
  if (!payload) return;

  if (payload.status === "ready") {
    elements.mitidStatus.textContent = "MitID approved.";
    elements.mitidOtp.textContent = "";
    elements.qrLeft.innerHTML = "";
    elements.qrRight.innerHTML = "";
    return;
  }

  elements.mitidStatus.textContent =
    payload.message || "Waiting for MitID approval...";

  if (payload.otpCode) {
    elements.mitidOtp.textContent = `OTP code: ${payload.otpCode}`;
  } else {
    elements.mitidOtp.textContent = "";
  }

  // QR rendering (prefer animated frames if available)
  const frames =
    (Array.isArray(payload.qrSvgs) && payload.qrSvgs.filter(Boolean)) || null;

  if (frames && frames.length) {
    const frame = frames[qrFrame % frames.length];
    elements.qrLeft.innerHTML = frame || "";
    elements.qrRight.innerHTML = "";
    qrFrame += 1;
    return;
  }

  if (payload.qrSvg) {
    elements.qrLeft.innerHTML = payload.qrSvg;
    elements.qrRight.innerHTML = "";
    return;
  }

  // No QR yet
  elements.qrLeft.innerHTML = "";
  elements.qrRight.innerHTML = "";
}

async function pollMitidStatus() {
  try {
    if (!state.connectToken) {
      stopMitidPolling();
      return;
    }
    const payload = await apiFetch("/api/aula/status", {
      method: "POST",
      body: JSON.stringify({ connectToken: state.connectToken }),
    });
    if (payload.status === "ready") {
      renderMitidStatus(payload);
      stopMitidPolling();
      state.connectToken = null;
      state.token = payload.token;
      localStorage.setItem("aula_token", payload.token);
      updateSessionStatus(payload.user?.mitidUsername || "Signed in");
      await refreshChildren();
      await refreshMetrics();
      setHint(elements.connectHint, "Connected. Ready to sync.");
    } else if (payload.status === "error") {
      renderMitidStatus(payload);
      stopMitidPolling();
      setHint(elements.connectHint, payload.error || "MitID error", true);
    } else {
      renderMitidStatus(payload);
    }
  } catch (error) {
    stopMitidPolling();
    setHint(elements.connectHint, error.message, true);
  }
}
async function refreshMetrics() {
  const childId = elements.childSelect.value || "";
  const query = childId ? `?childId=${encodeURIComponent(childId)}` : "";
  const { metrics } = await apiFetch(`/api/metrics${query}`);
  state.metrics = metrics;
  renderMetrics(metrics);
}

elements.connectForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(event.target);
  setHint(elements.connectHint, "Connecting...");
  try {
    const payload = await apiFetch("/api/aula/connect", {
      method: "POST",
      body: JSON.stringify({
        aulaUsername: formData.get("aulaUsername"),
        aulaPassword: formData.get("aulaPassword"),
      }),
    });
    if (payload.status === "ready") {
      state.token = payload.token;
      localStorage.setItem("aula_token", payload.token);
      updateSessionStatus(payload.user?.mitidUsername || "Signed in");
      state.children = payload.children || [];
      renderChildSelector(state.children);
      setHint(elements.connectHint, "Connected. Ready to sync.");
      await refreshMetrics();
      return;
    }
    if (payload.status === "pending") {
      renderMitidStatus(payload);
      setHint(elements.connectHint, "Approve MitID login.");
      stopMitidPolling();
      state.connectToken = payload.connectToken;
      mitidPollTimer = setInterval(pollMitidStatus, 3000);
      return;
    }
    setHint(elements.connectHint, payload.error || "MitID error", true);
  } catch (error) {
    setHint(elements.connectHint, error.message, true);
  }
});

elements.syncButton.addEventListener("click", async () => {
  setHint(elements.syncHint, "Syncing lessons...");
  try {
    const payload = await apiFetch("/api/aula/sync", {
      method: "POST",
      body: JSON.stringify({ months: 6 }),
    });
    if (payload.status && payload.status !== "ready") {
      renderMitidStatus(payload);
      setHint(elements.syncHint, "Approve MitID login first.");
      stopMitidPolling();
      mitidPollTimer = setInterval(pollMitidStatus, 3000);
      return;
    }
    setHint(elements.syncHint, "Sync complete.");
    await refreshMetrics();
  } catch (error) {
    setHint(elements.syncHint, error.message, true);
  }
});

elements.childSelect.addEventListener("change", () => {
  refreshMetrics().catch(() => {});
});

elements.logoutButton.addEventListener("click", () => {
  state.token = null;
  state.connectToken = null;
  localStorage.removeItem("aula_token");
  updateSessionStatus();
  setHint(elements.connectHint, "Signed out.");
});

elements.deleteButton.addEventListener("click", async () => {
  setHint(elements.deleteHint, "Deleting data...");
  try {
    await apiFetch("/api/account/delete", { method: "POST" });
    state.token = null;
    localStorage.removeItem("aula_token");
    updateSessionStatus();
    setHint(elements.deleteHint, "Data deleted.");
  } catch (error) {
    setHint(elements.deleteHint, error.message, true);
  }
});

elements.resetMitidButton.addEventListener("click", async () => {
  setHint(elements.connectHint, "Resetting MitID session...");
  stopMitidPolling();
  try {
    await apiFetch("/api/aula/reset", {
      method: "POST",
      body: JSON.stringify({ connectToken: state.connectToken }),
    });
    state.connectToken = null;
    elements.mitidStatus.textContent = "Waiting to start.";
    elements.mitidOtp.textContent = "";
    elements.qrLeft.innerHTML = "";
    elements.qrRight.innerHTML = "";
    setHint(elements.connectHint, "MitID session reset. Connect again.");
  } catch (error) {
    setHint(elements.connectHint, error.message, true);
  }
});

async function bootstrap() {
  if (!state.token) return;
  try {
    const payload = await apiFetch("/api/session");
    updateSessionStatus(payload.user.mitidUsername);
    await refreshChildren();
    await refreshMetrics();
  } catch (error) {
    state.token = null;
    localStorage.removeItem("aula_token");
    updateSessionStatus();
  }
}

bootstrap();
