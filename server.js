// SPDX-License-Identifier: GPL-3.0-only
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import {
  savePendingAuth,
  takePendingAuth,
  createSession,
  getSession,
  updateSession,
  deleteSession,
} from "./src/store.js";
import {
  generatePkce,
  buildAuthUrl,
  parseCallbackUrl,
  exchangeCode,
} from "./src/oidc.js";
import { initAulaSession, fetchLessons } from "./src/aula_api.js";
import { computeMetrics, normalizeLessons } from "./src/metrics.js";

const app = express();
const port = process.env.PORT || 3000;
const host = process.env.HOST || "127.0.0.1";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

function requireAuth(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing token" });
  const session = getSession(token);
  if (!session) return res.status(401).json({ error: "Invalid or expired session" });
  req.sessionToken = token;
  req.session = session;
  next();
}

// Step 1 — generate PKCE challenge and return the Aula authorization URL.
// Frontend opens this URL in a new tab; user logs in at login.aula.dk.
app.get("/api/auth/start", (req, res) => {
  const level = parseInt(req.query.level || "3", 10);
  const { codeVerifier, codeChallenge, state } = generatePkce();
  const sessionId = savePendingAuth({ codeVerifier, state, level });
  const authUrl = buildAuthUrl({ codeChallenge, state, level });
  res.json({ authUrl, sessionId });
});

// Step 2 — user pastes the callback URL (https://app-private.aula.dk?code=...&state=...).
// We validate state, exchange the code for tokens, and initialize the Aula API session.
app.post("/api/auth/callback", async (req, res) => {
  const { callbackUrl, sessionId } = req.body || {};
  const pending = takePendingAuth(sessionId);
  if (!pending)
    return res.status(400).json({ error: "Unknown or expired login session" });

  let parsed;
  try {
    parsed = parseCallbackUrl(callbackUrl);
  } catch {
    return res.status(400).json({ error: "Invalid callback URL" });
  }

  if (parsed.error)
    return res.status(400).json({ error: parsed.errorDescription || parsed.error });
  if (!parsed.code || !parsed.state)
    return res.status(400).json({
      error:
        "The URL you pasted is missing the authorization code or state. " +
        "Copy the complete address from Aula's Fortsæt login page, including " +
        "the returnUri parameter on app-redirect.aula.dk, or the original " +
        "app-private.aula.dk URL with code and state. Start a new login if the address has no parameters.",
    });
  if (parsed.state !== pending.state)
    return res.status(400).json({
      error:
        "This URL does not match the login session that was started. " +
        "Please click 'Open Aula Login' again to start a new session.",
    });

  try {
    const tokens = await exchangeCode({
      code: parsed.code,
      codeVerifier: pending.codeVerifier,
      level: pending.level,
    });
    const { apiBase, cookies, children } = await initAulaSession(tokens.access_token);
    const token = createSession({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_in,
      level: pending.level,
      apiBase,
      cookies,
      children,
    });
    res.json({ token, children });
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

app.get("/api/session", requireAuth, (req, res) => {
  res.json({ children: req.session.children });
});

app.get("/api/children", requireAuth, (req, res) => {
  res.json({ children: req.session.children });
});

// Fetch lessons from Aula and store them in the in-memory session.
app.post("/api/aula/sync", requireAuth, async (req, res) => {
  const { months = 6 } = req.body || {};
  const { accessToken, apiBase, cookies, children } = req.session;
  try {
    const raw = await fetchLessons({ apiBase, cookies, accessToken, children, months });
    const lessons = normalizeLessons(raw);
    updateSession(req.sessionToken, { lessons });
    res.json({ synced: lessons.length });
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

// Compute metrics from in-memory lessons (no DB read needed).
app.get("/api/metrics", requireAuth, (req, res) => {
  const { lessons } = req.session;
  if (!lessons) return res.json({ metrics: null });
  const childId = req.query.childId || null;
  const filtered = childId ? lessons.filter((l) => l.childId === childId) : lessons;
  res.json({ metrics: computeMetrics(filtered) });
});

app.post("/api/logout", requireAuth, (req, res) => {
  deleteSession(req.sessionToken);
  res.json({ ok: true });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(port, host, () => {
  console.log(`Aula Insights running on http://localhost:${port}`);
});
