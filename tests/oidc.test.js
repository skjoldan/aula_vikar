// SPDX-License-Identifier: GPL-3.0-only
import test from "node:test";
import assert from "node:assert/strict";
import { parseCallbackUrl } from "../src/oidc.js";

const callback = "https://app-private.aula.dk?code=TEST_CODE&state=TEST_STATE";
const expected = { code: "TEST_CODE", state: "TEST_STATE", error: null, errorDescription: null };
function wrap(url, key = "returnUri") {
  const outer = new URL(key === "returnUri" ? "https://app-redirect.aula.dk/" : "https://app-private.aula.dk/");
  outer.searchParams.set(key, Buffer.from(url).toString("base64"));
  return outer.href;
}

test("accepts the app-redirect returnUri used by Aula's Fortsæt login page", () => {
  assert.deepEqual(parseCallbackUrl(wrap(callback)), expected);
});

test("retains direct, base64 and redirectTo callback support", () => {
  for (const input of [callback, Buffer.from(callback).toString("base64"), wrap(callback, "redirectTo")]) {
    assert.deepEqual(parseCallbackUrl(input), expected);
  }
});

test("unwraps nested Aula returnUri and redirectTo parameters", () => {
  assert.deepEqual(parseCallbackUrl(wrap(wrap(callback), "redirectTo")), expected);
  assert.deepEqual(parseCallbackUrl(Buffer.from(wrap(callback)).toString("base64url")), expected);
});

test("preserves encoded code/state values and errors through the handoff", () => {
  const url = new URL("https://app-private.aula.dk/");
  url.searchParams.set("code", "test+code/with=symbols");
  url.searchParams.set("state", "test-state");
  assert.equal(parseCallbackUrl(wrap(url.href)).code, "test+code/with=symbols");
  const error = parseCallbackUrl(wrap("https://app-private.aula.dk?error=access_denied&error_description=User+cancelled&state=TEST_STATE"));
  assert.equal(error.error, "access_denied");
  assert.equal(error.errorDescription, "User cancelled");
});

test("rejects malformed wrappers without echoing input and bounds nesting", () => {
  for (const input of [null, "", "not a URL", "https://app-redirect.aula.dk/?returnUri=not-base64!", wrap("javascript:alert(1)")]) {
    assert.throws(() => parseCallbackUrl(input));
  }
  let nested = callback;
  for (let i = 0; i < 7; i += 1) nested = wrap(nested);
  assert.throws(() => parseCallbackUrl(nested), /Too many nested/);
  assert.equal(parseCallbackUrl("https://app-redirect.aula.dk/").code, null);
});
