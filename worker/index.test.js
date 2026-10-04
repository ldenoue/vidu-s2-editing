import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createViduSession, proxyViduWebSocket } from "./index.js";

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

test("proxies browser WebSockets to the matching Vidu environment without Origin", async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url: String(url), init };
    return new Response("upstream rejected test credentials", { status: 401 });
  };

  const request = new Request(
    "https://example.test/api/vidu/ws?env=ovs&live_id=live-test&conn_id=conn-test&client_secret=secret-test",
    {
      headers: {
        Upgrade: "websocket",
        Origin: "https://example.test",
        "Sec-WebSocket-Key": "test-key",
        "Sec-WebSocket-Version": "13",
      },
    },
  );
  const response = await proxyViduWebSocket(request);

  assert.equal(response.status, 401);
  assert.equal(
    captured.url,
    "https://api.vidu.com/live/ws/live/connect?live_id=live-test&conn_id=conn-test&client_secret=secret-test",
  );
  assert.equal(captured.init.headers.get("Origin"), null);
  assert.equal(captured.init.headers.get("Upgrade"), "websocket");
});

test("rejects non-WebSocket requests to the WebSocket proxy", async () => {
  const response = await proxyViduWebSocket(new Request("https://example.test/api/vidu/ws"));
  assert.equal(response.status, 426);
});
