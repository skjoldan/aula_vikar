import fs from "fs";
import path from "path";

const dataDir = path.resolve("data");
const dbPath = path.join(dataDir, "db.json");

const emptyDb = {
  users: [],
  sessions: [],
  children: [],
  lessons: [],
};

export function ensureDb() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  if (!fs.existsSync(dbPath)) {
    fs.writeFileSync(dbPath, JSON.stringify(emptyDb, null, 2));
  }
}

export function readDb() {
  const raw = fs.readFileSync(dbPath, "utf8");
  try {
    return JSON.parse(raw);
  } catch (error) {
    fs.writeFileSync(dbPath, JSON.stringify(emptyDb, null, 2));
    return JSON.parse(JSON.stringify(emptyDb));
  }
}

export function writeDb(db) {
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
}
