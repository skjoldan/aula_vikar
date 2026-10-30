// SPDX-License-Identifier: GPL-3.0-only
// In-memory store only — nothing is persisted to disk.
// All sessions are lost on server restart.

import crypto from "crypto";

const pendingAuth = new Map(); // sessionId → { codeVerifier, state, level, expiresAt }
const sessions = new Map();   // token → session object

// Clean up expired entries every minute
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pendingAuth) if (v.expiresAt < now) pendingAuth.delete(k);
  for (const [k, v] of sessions) if (v.expiresAt < now) sessions.delete(k);
}, 60_000).unref();

export function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function savePendingAuth({ codeVerifier, state, level }) {
  const id = randomToken(16);
  pendingAuth.set(id, {
    codeVerifier,
    state,
    level,
    expiresAt: Date.now() + 10 * 60_000, // 10 minutes to complete login
  });
  return id;
}

// Returns and removes the pending auth entry (one-time use)
export function takePendingAuth(id) {
  const entry = pendingAuth.get(id);
  if (!entry) return null;
  pendingAuth.delete(id);
  return entry;
}

export function createSession({
  accessToken,
  refreshToken,
  expiresIn,
  level,
  apiBase,
  cookies,
  children,
}) {
  const token = randomToken(24);
  sessions.set(token, {
    accessToken,
    refreshToken,
    level,
    expiresAt: Date.now() + (expiresIn ?? 3600) * 1000,
    apiBase,
    cookies,
    children,
    lessons: null, // populated after first sync
  });
  return token;
}

export function getSession(token) {
  const s = sessions.get(token);
  if (!s) return null;
  if (s.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return s;
}

export function updateSession(token, patch) {
  const s = sessions.get(token);
  if (s) sessions.set(token, { ...s, ...patch });
}

export function deleteSession(token) {
  sessions.delete(token);
}
