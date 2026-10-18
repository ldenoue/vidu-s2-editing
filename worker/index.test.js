import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  createReactorToken,
  createViduSession,
  createXmaxRealtimeKey,
  getXmaxBalance,
  proxyViduWebSocket,
} from "./index.js";

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

test("exchanges an Xmax permanent key for a bounded temporary browser key", async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url: String(url), init };
    return Response.json({
      success: true,
      data: {
        temporaryApiKey: "tk-short-lived-test-key",
        expireTimestamp: "2026-10-05T12:00:00.000+00:00",
      },
    });
  };

  const response = await createXmaxRealtimeKey(new Request("https://example.test/api/xmax/realtime-key", {
    method: "POST",
    headers: {
      Authorization: "uk-permanent-test-key",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ durationSeconds: 10 }),
  }));

  assert.equal(response.status, 200);
  assert.equal(captured.url, "https://api.xmax.ai/open/api/v1/temporary-api-key");
  assert.equal(captured.init.headers["X-Api-Key"], "uk-permanent-test-key");
  assert.deepEqual(JSON.parse(captured.init.body), {
    expireSeconds: 130,
    pointsLimit: 40,
  });
  assert.deepEqual(await response.json(), {
    temporaryApiKey: "tk-short-lived-test-key",
    expireTimestamp: "2026-10-05T12:00:00.000+00:00",
  });
});

test("rejects malformed Xmax keys and excessive session durations", async () => {
  const badKeyResponse = await createXmaxRealtimeKey(new Request("https://example.test/api/xmax/realtime-key", {
    method: "POST",
    headers: {
      Authorization: "tk-not-a-permanent-key",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ durationSeconds: 10 }),
  }));
  assert.equal(badKeyResponse.status, 401);

  const badDurationResponse = await createXmaxRealtimeKey(new Request("https://example.test/api/xmax/realtime-key", {
    method: "POST",
    headers: {
      Authorization: "uk-permanent-test-key",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ durationSeconds: 300 }),
  }));
  assert.equal(badDurationResponse.status, 400);
});

test("returns the Xmax credit balance without exposing the permanent key", async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url: String(url), init };
    return Response.json({ success: true, data: { currentBalance: 1234 } });
  };

  const response = await getXmaxBalance(new Request("https://example.test/api/xmax/balance", {
    headers: { Authorization: "Bearer uk-permanent-test-key" },
  }));

  assert.equal(response.status, 200);
  assert.equal(captured.url, "https://api.xmax.ai/open/api/v1/points/balance");
  assert.equal(captured.init.headers["X-Api-Key"], "uk-permanent-test-key");
  assert.deepEqual(await response.json(), { currentBalance: 1234 });
});

test("rejects malformed Xmax balance keys and invalid upstream balances", async () => {
  const badKeyResponse = await getXmaxBalance(new Request("https://example.test/api/xmax/balance", {
    headers: { Authorization: "tk-not-a-permanent-key" },
  }));
  assert.equal(badKeyResponse.status, 401);

  globalThis.fetch = async () => Response.json({
    success: false,
    code: 46002,
    message: "Invalid user API Key",
  });
  const invalidUpstreamResponse = await getXmaxBalance(new Request("https://example.test/api/xmax/balance", {
    headers: { Authorization: "uk-invalid-key" },
  }));
  assert.equal(invalidUpstreamResponse.status, 401);
  assert.deepEqual(await invalidUpstreamResponse.json(), { message: "Invalid user API Key" });
});

test("exchanges a Reactor key for a tightly scoped X2 browser token", async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url: String(url), init };
    return Response.json({ jwt: "short-lived-reactor-jwt", expires_at: 1791965011 });
  };

  const response = await createReactorToken(new Request("https://example.test/api/reactor/token", {
    method: "POST",
    headers: {
      Authorization: "rk_user-test-key",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ durationSeconds: 30 }),
  }));

  assert.equal(response.status, 200);
  assert.equal(captured.url, "https://api.reactor.inc/tokens");
  assert.equal(captured.init.headers["Reactor-API-Key"], "rk_user-test-key");
  assert.deepEqual(JSON.parse(captured.init.body), {
    expires_after: 300,
    authorization_details: [{
      type: "session",
      resources: { models: { match: ["xmax/x2"] } },
      constraints: { max_sessions: 1, max_session_duration_seconds: 150 },
    }],
  });
  assert.deepEqual(await response.json(), {
    jwt: "short-lived-reactor-jwt",
    expires_at: 1791965011,
  });
});

test("requires a Reactor key and validates requested duration", async () => {
  const request = (durationSeconds, authorization = "") => new Request("https://example.test/api/reactor/token", {
    method: "POST",
    headers: { Authorization: authorization, "Content-Type": "application/json" },
    body: JSON.stringify({ durationSeconds }),
  });

  assert.equal((await createReactorToken(request(10))).status, 401);
  assert.equal((await createReactorToken(request(31, "rk_user-test-key"))).status, 400);
});
