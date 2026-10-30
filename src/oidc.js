// SPDX-License-Identifier: GPL-3.0-only
import crypto from "crypto";

const AUTHORIZE_URL =
  "https://login.aula.dk/simplesaml/module.php/oidc/authorize.php";
const TOKEN_URL =
  "https://login.aula.dk/simplesaml/module.php/oidc/token.php";
const FALLBACK_REDIRECT_URI = "https://app-private.aula.dk";

// Client IDs from reverse-engineering the Aula mobile app
const CLIENT_IDS = {
  2: "_742adb5e2759028d86dbadf4af44ef70e8b1f407a6", // UniLogin
  3: "_99949a54b8b65423862aac1bf629599ed64231607a", // MitID
};
const SCOPES = { 2: "aula", 3: "aula-sensitive" };

export function generatePkce() {
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto
    .createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");
  const state = crypto.randomBytes(16).toString("base64url");
  return { codeVerifier, codeChallenge, state };
}

export function buildAuthUrl({ codeChallenge, state, level = 3, redirectUri }) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_IDS[level] ?? CLIENT_IDS[2],
    scope: SCOPES[level] ?? SCOPES[2],
    redirect_uri: redirectUri ?? FALLBACK_REDIRECT_URI,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
  });
  return `${AUTHORIZE_URL}?${params}`;
}

export function parseCallbackUrl(rawInput) {
  if (typeof rawInput !== "string" || !rawInput.trim()) {
    throw new Error("Invalid callback URL");
  }

  function decodeCallback(value) {
    if (/^https?:\/\//i.test(value)) return value;
    // URLSearchParams decodes a literal '+' to a space; recover base64 padding/data.
    const encoded = value.trim().replace(/ /g, "+").replace(/[\r\n\t]/g, "");
    if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(encoded)) {
      throw new Error("Invalid encoded callback URL");
    }
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    if (!/^https?:\/\//i.test(decoded)) throw new Error("Invalid encoded callback URL");
    return decoded;
  }

  let current = rawInput.trim();
  // Aula's app-private page wraps the original callback in app-redirect's
  // base64 returnUri parameter. redirectTo wrappers may also be nested.
  for (let depth = 0; depth < 6; depth += 1) {
    const url = new URL(decodeCallback(current));
    if (url.searchParams.has("code") || url.searchParams.has("error")) {
      return {
        code: url.searchParams.get("code"),
        state: url.searchParams.get("state"),
        error: url.searchParams.get("error"),
        errorDescription: url.searchParams.get("error_description"),
      };
    }
    const wrapped = url.searchParams.get("returnUri") || url.searchParams.get("redirectTo");
    if (!wrapped) {
      return { code: null, state: url.searchParams.get("state"), error: null, errorDescription: null };
    }
    current = wrapped;
  }
  throw new Error("Too many nested callback URLs");
}

export async function exchangeCode({ code, codeVerifier, level = 3, redirectUri }) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri ?? FALLBACK_REDIRECT_URI,
    client_id: CLIENT_IDS[level] ?? CLIENT_IDS[2],
    code_verifier: codeVerifier,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = {}; }
  if (!res.ok) {
    console.error("Token exchange error:", res.status, text);
    throw new Error(
      data.error_description || data.error || `Token exchange failed (${res.status})`
    );
  }
  return data; // { access_token, refresh_token, expires_in, token_type }
}
