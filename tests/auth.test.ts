import test from "node:test";
import assert from "node:assert/strict";
import { sameOrigin } from "../lib/auth";

const request = (url: string, headers: Record<string, string>) => new Request(url, { method: "POST", headers });

test("same-origin check accepts the host the browser targeted and rejects other origins", () => {
  // Next dev can expose request.url as localhost while the browser used 127.0.0.1.
  assert.equal(sameOrigin(request("http://localhost:4601/api/session", { origin: "http://127.0.0.1:4601", host: "127.0.0.1:4601" })), true);
  assert.equal(sameOrigin(request("http://localhost:4601/api/session", { origin: "http://localhost:4601" })), true);
  assert.equal(sameOrigin(request("http://localhost:4601/api/session", { origin: "https://evil.example", host: "127.0.0.1:4601" })), false);
  assert.equal(sameOrigin(request("http://localhost:4601/api/session", { origin: "not a url" })), false);
});
