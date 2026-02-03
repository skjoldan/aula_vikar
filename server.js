import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { ensureDb, readDb, writeDb } from "./src/store.js";
import { decryptSecret, encryptSecret, randomToken } from "./src/crypto.js";
import { fetchAulaLessons, fetchAulaProfile } from "./src/aula_wrapper.js";
import {
  computeMetrics,
  normalizeLessons,
  filterLessonsByChild,
} from "./src/metrics.js";
import { fetchAulaAuthStatus, fetchAulaAuthReset } from "./src/aula_wrapper.js";

const app = express();
const port = process.env.PORT || 3000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const staticDir = path.join(__dirname, "public");

ensureDb();

app.use(express.json({ limit: "1mb" }));
app.use(express.static(staticDir));

const pendingConnections = new Map();

function requireAuth(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing token" });
  const db = readDb();
  const session = db.sessions.find(
    (entry) => entry.token === token && entry.expiresAt > Date.now()
  );
  if (!session) return res.status(401).json({ error: "Invalid session" });
  const user = db.users.find((entry) => entry.id === session.userId);
  if (!user) return res.status(401).json({ error: "Unknown user" });
  req.user = user;
  req.session = session;
  next();
}

function getUserFromAuth(req, db) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;
  const session = db.sessions.find(
    (entry) => entry.token === token && entry.expiresAt > Date.now()
  );
  if (!session) return null;
  return db.users.find((entry) => entry.id === session.userId) || null;
}

function sanitizeUser(user) {
  return {
    id: user.id,
    mitidUsername: user.mitidUsername,
    createdAt: user.createdAt,
  };
}

function createSession(db, userId) {
  const token = randomToken(24);
  const session = {
    token,
    userId,
    expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 7,
  };
  db.sessions.push(session);
  return token;
}

app.get("/api/session", requireAuth, (req, res) => {
  res.json({ user: sanitizeUser(req.user) });
});

app.post("/api/aula/connect", async (req, res) => {
  const { aulaUsername, aulaPassword } = req.body || {};
  if (!aulaUsername) {
    return res.status(400).json({ error: "MitID user ID required" });
  }
  const db = readDb();
  const encrypted = encryptSecret(
    JSON.stringify({ aulaUsername, aulaPassword })
  );
  try {
    const profile = await fetchAulaProfile({ aulaUsername, aulaPassword });
    if (profile.status && profile.status !== "ready") {
      const connectToken = randomToken(12);
      pendingConnections.set(connectToken, {
        aulaUsername,
        aulaPassword,
        encrypted,
        createdAt: Date.now(),
      });
      return res.json({ ...profile, connectToken });
    }
    const children = profile.children || [];
    let user = db.users.find((entry) => entry.mitidUsername === aulaUsername);
    if (!user) {
      user = {
        id: randomToken(12),
        mitidUsername: aulaUsername,
        createdAt: new Date().toISOString(),
        aulaCredentials: encrypted,
      };
      db.users.push(user);
    } else {
      user.aulaCredentials = encrypted;
    }
    db.children = db.children.filter((child) => child.userId !== user.id);
    children.forEach((child) => {
      db.children.push({ ...child, userId: user.id });
    });
    const token = createSession(db, user.id);
    writeDb(db);
    return res.json({ status: "ready", token, user: sanitizeUser(user), children });
  } catch (error) {
    return res.status(502).json({ error: error.message });
  }
});

app.post("/api/aula/status", async (req, res) => {
  const { connectToken } = req.body || {};
  const db = readDb();
  let pending = null;
  if (connectToken && pendingConnections.has(connectToken)) {
    pending = pendingConnections.get(connectToken);
  } else {
    const user = getUserFromAuth(req, db);
    if (user?.aulaCredentials) {
      const credentials = JSON.parse(decryptSecret(user.aulaCredentials));
      pending = {
        aulaUsername: credentials.aulaUsername,
        aulaPassword: credentials.aulaPassword,
        encrypted: user.aulaCredentials,
      };
    }
  }
  if (!pending) {
    return res.status(404).json({ error: "Unknown login session" });
  }
  try {
    const status = await fetchAulaAuthStatus({
      aulaUsername: pending.aulaUsername,
      aulaPassword: pending.aulaPassword,
    });
    if (status.status && status.status !== "ready") {
      return res.json(status);
    }
    const profile = await fetchAulaProfile({
      aulaUsername: pending.aulaUsername,
      aulaPassword: pending.aulaPassword,
    });
    if (profile.status && profile.status !== "ready") {
      return res.json(profile);
    }
    const children = profile.children || [];
    let user = db.users.find(
      (entry) => entry.mitidUsername === pending.aulaUsername
    );
    if (!user) {
      user = {
        id: randomToken(12),
        mitidUsername: pending.aulaUsername,
        createdAt: new Date().toISOString(),
        aulaCredentials: pending.encrypted,
      };
      db.users.push(user);
    } else {
      user.aulaCredentials = pending.encrypted;
    }
    db.children = db.children.filter((child) => child.userId !== user.id);
    children.forEach((child) => {
      db.children.push({ ...child, userId: user.id });
    });
    const token = createSession(db, user.id);
    if (connectToken) {
      pendingConnections.delete(connectToken);
    }
    writeDb(db);
    return res.json({
      status: "ready",
      token,
      user: sanitizeUser(user),
      children,
    });
  } catch (error) {
    return res.status(502).json({ error: error.message });
  }
});

app.post("/api/aula/reset", async (req, res) => {
  const { connectToken } = req.body || {};
  const db = readDb();
  let pending = null;
  if (connectToken && pendingConnections.has(connectToken)) {
    pending = pendingConnections.get(connectToken);
  } else {
    const user = getUserFromAuth(req, db);
    if (user?.aulaCredentials) {
      const credentials = JSON.parse(decryptSecret(user.aulaCredentials));
      pending = {
        aulaUsername: credentials.aulaUsername,
        aulaPassword: credentials.aulaPassword,
        encrypted: user.aulaCredentials,
      };
    }
  }
  if (!pending) {
    return res.status(404).json({ error: "Unknown login session" });
  }
  try {
    const response = await fetchAulaAuthReset({
      aulaUsername: pending.aulaUsername,
      aulaPassword: pending.aulaPassword,
    });
    if (connectToken) {
      pendingConnections.delete(connectToken);
    }
    return res.json(response);
  } catch (error) {
    return res.status(502).json({ error: error.message });
  }
});

app.get("/api/children", requireAuth, (req, res) => {
  const db = readDb();
  const children = db.children.filter((child) => child.userId === req.user.id);
  return res.json({ children });
});

app.post("/api/aula/sync", requireAuth, async (req, res) => {
  const { months = 6 } = req.body || {};
  const db = readDb();
  const user = db.users.find((entry) => entry.id === req.user.id);
  if (!user?.aulaCredentials) {
    return res.status(400).json({ error: "Aula not connected" });
  }
  const credentials = JSON.parse(decryptSecret(user.aulaCredentials));
  const children = db.children.filter((child) => child.userId === user.id);
  try {
    const lessonPayload = await fetchAulaLessons({
      credentials,
      months,
      children,
    });
    if (lessonPayload.status && lessonPayload.status !== "ready") {
      return res.json(lessonPayload);
    }
    const normalized = normalizeLessons(lessonPayload.lessons || []);
    console.log(`Synced ${normalized.length} lessons for user ${user.id}`);
    db.lessons = db.lessons.filter((lesson) => lesson.userId !== user.id);
    normalized.forEach((lesson) => {
      db.lessons.push({ ...lesson, userId: user.id });
    });
    writeDb(db);
    return res.json({ synced: normalized.length });
  } catch (error) {
    return res.status(502).json({ error: error.message });
  }
});

app.get("/api/metrics", requireAuth, (req, res) => {
  const childId = req.query.childId || null;
  const db = readDb();
  const scopedLessons = filterLessonsByChild(db.lessons, req.user.id, childId);
  const metrics = computeMetrics(scopedLessons);
  res.json({ metrics });
});

app.post("/api/account/delete", requireAuth, (req, res) => {
  const db = readDb();
  const userId = req.user.id;
  db.users = db.users.filter((entry) => entry.id !== userId);
  db.sessions = db.sessions.filter((entry) => entry.userId !== userId);
  db.children = db.children.filter((entry) => entry.userId !== userId);
  db.lessons = db.lessons.filter((entry) => entry.userId !== userId);
  writeDb(db);
  res.json({ deleted: true });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(staticDir, "index.html"));
});

app.listen(port, () => {
  const keyStatus = process.env.AULA_ENC_KEY
    ? "OK"
    : "MISSING (using ephemeral key)";
  console.log(`Aula Insights running on http://localhost:${port}`);
  console.log(`Credential key status: ${keyStatus}`);
});
