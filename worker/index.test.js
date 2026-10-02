import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createViduSession } from "./index.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function sessionRequest({ authorization = "", environment = "ovs", body } = {}) {
  return new Request(`https://example.test/api/session?env=${environment}`, {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body ?? {
      image_url: "https://example.com/reference.png",
      editing_type: "style_transfer",
    }),
  });
}

test("rejects a missing or malformed API key", async () => {
  const response = await createViduSession(sessionRequest());
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { message: "A valid Vidu API key is required" });
});

test("rejects an unknown environment", async () => {
  const response = await createViduSession(sessionRequest({
    authorization: "vda_test_key_for_unit_tests",
    environment: "unknown",
  }));
  assert.equal(response.status, 400);
});

test("forwards the user's key and approved session fields to Vidu", async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return Response.json({
      live: { id: "live-test" },
      client_secret: "short-lived-test-secret",
    });
  };

  const response = await createViduSession(sessionRequest({
    authorization: "Token vda_test_key_for_unit_tests",
    environment: "cn",
  }));

  assert.equal(response.status, 200);
  assert.equal(captured.url, "https://api.vidu.cn/live/s_editing/realtime");
  assert.equal(captured.init.headers.Authorization, "vda_test_key_for_unit_tests");
  assert.deepEqual(JSON.parse(captured.init.body), {
    image_url: "https://example.com/reference.png",
    editing_type: "style_transfer",
  });
});
