import test from "node:test";
import assert from "node:assert/strict";
import { metadataSchema, PayloadError, readJson } from "../lib/payload";

test("bounded JSON accepts valid request without length header", async () => {
  assert.deepEqual(
    await readJson(
      new Request("http://localhost", { method: "POST", body: '{"ok":true}' }),
    ),
    { ok: true },
  );
});
test("malformed JSON remains a client syntax error", async () => {
  await assert.rejects(
    readJson(new Request("http://localhost", { method: "POST", body: "{" })),
    SyntaxError,
  );
});
test("stream limit applies without trustworthy content length", async () => {
  await assert.rejects(
    readJson(
      new Request("http://localhost", {
        method: "POST",
        body: '{"large":"xxxxxxxx"}',
      }),
      8,
    ),
    (e: unknown) => e instanceof PayloadError && e.status === 413,
  );
});
test("metadata limit counts UTF8 bytes", () => {
  assert.equal(
    metadataSchema.safeParse({ description: "á".repeat(9000) }).success,
    false,
  );
  assert.equal(
    metadataSchema.safeParse({ model: "yamnet", windows: 3 }).success,
    true,
  );
});
