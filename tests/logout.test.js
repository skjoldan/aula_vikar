// SPDX-License-Identifier: GPL-3.0-only
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

// Small DOM adapter for checking privacy state and asynchronous request ordering.
// Actual layout and interaction are verified separately in the browser.
class Element {
  children = [];
  value = "";
  style = {};
  handlers = {};
  textContent = "";
  set innerHTML(value) { this.children = []; this.textContent = value; }
  appendChild(child) { this.children.push(child); }
  addEventListener(name, callback) { this.handlers[name] = callback; }
}
const response = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const metrics = {
  totalLessons: 4, substituteLessons: 1, substitutePercent: 25,
  perSubject: [{ subject: "Math", substitutePercent: 25 }],
  perMonth: [{ month: "2026-01", substitutePercent: 25 }],
  longestSubstituteStreak: { lessons: 1, range: { start: "2026-01-15", end: "2026-01-15" } },
};

function harness() {
  const elements = {};
  const storage = new Map();
  const requests = [];
  let intercept = () => null;
  const context = vm.createContext({
    sessionStorage: { getItem: (k) => storage.get(k), setItem: (k, v) => storage.set(k, v), removeItem: (k) => storage.delete(k) },
    document: {
      getElementById: (id) => elements[id] ??= new Element(),
      createElement: () => new Element(), createTextNode: (value) => ({ textContent: value }),
      querySelector: () => ({ value: "3" }),
    },
    window: { open() {} },
    fetch: async (path, options) => {
      requests.push({ path, options });
      const custom = intercept(path);
      if (custom) return custom;
      if (path.startsWith("/api/auth/start")) return response({ authUrl: "https://example.invalid", sessionId: "pending" });
      if (path === "/api/auth/callback") return response({ token: "test-token", children: [{ id: "1", name: "Test child", className: "5A" }] });
      if (path.startsWith("/api/metrics")) return response({ metrics });
      if (path === "/api/aula/sync") return response({ synced: 4 });
      return response({ ok: true });
    },
  });
  vm.runInContext(readFileSync(new URL("../public/app.js", import.meta.url), "utf8"), context);
  const click = (id) => elements[id].handlers.click();
  return {
    elements, storage, requests, click, intercept: (fn) => { intercept = fn; },
    async login() {
      await click("startLoginButton");
      elements.callbackUrl.value = "https://example.invalid?code=test&state=test";
      await click("completeLoginButton");
      await click("syncButton");
      assert.equal(elements.metricsCards.children.length, 4);
    },
  };
}

function assertCleared(app) {
  for (const id of ["metricsCards", "subjectBars", "monthBars", "childSelect"]) assert.equal(app.elements[id].children.length, 0, id);
  assert.equal(app.elements.streakInfo.textContent, "");
  assert.equal(app.elements.callbackUrl.value, "");
  assert.equal(app.elements.callbackSection.style.display, "none");
  assert.equal(app.elements.syncHint.textContent, "");
  assert.equal(app.elements.sessionStatus.textContent, "Signed out");
  assert.equal(app.storage.has("aula_token"), false);
}

test("logout clears child data immediately even when the server request fails", async () => {
  const app = harness();
  await app.login();
  const pending = deferred();
  app.intercept((path) => path === "/api/logout" ? pending.promise : null);
  const logout = app.click("logoutButton");
  assertCleared(app);
  assert.equal(app.requests.at(-1).options.headers.Authorization, "Bearer test-token");
  pending.resolve(response({ error: "offline" }, 502));
  await logout;
  assertCleared(app);
});

test("late metrics cannot repaint private data after logout", async () => {
  const app = harness();
  await app.login();
  const pending = deferred();
  app.intercept((path) => path.startsWith("/api/metrics") ? pending.promise : null);
  const sync = app.click("syncButton");
  await new Promise(setImmediate);
  await app.click("logoutButton");
  pending.resolve(response({ metrics }));
  await sync;
  assertCleared(app);
});

test("expired session clears the dashboard and a new login starts without old metrics", async () => {
  const app = harness();
  await app.login();
  app.intercept((path) => path === "/api/aula/sync" ? response({ error: "expired" }, 401) : null);
  await app.click("syncButton");
  assertCleared(app);
  app.intercept(() => null);
  await app.click("startLoginButton");
  app.elements.callbackUrl.value = "https://example.invalid?code=test&state=test";
  await app.click("completeLoginButton");
  assert.equal(app.elements.sessionStatus.textContent, "Signed in");
  assert.equal(app.elements.metricsCards.children.length, 0);
});

test("a login completing after logout cannot sign the browser back in", async () => {
  const app = harness();
  await app.click("startLoginButton");
  app.elements.callbackUrl.value = "https://example.invalid?code=test&state=test";
  const pending = deferred();
  app.intercept((path) => path === "/api/auth/callback" ? pending.promise : null);
  const login = app.click("completeLoginButton");
  await app.click("logoutButton");
  pending.resolve(response({ token: "late-token", children: [{ id: "1", name: "Test child" }] }));
  await login;
  assertCleared(app);
});
