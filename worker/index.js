const VIDU_ORIGINS = {
  cn: "https://api.vidu.cn",
  ovs: "https://api.vidu.com",
};

const XMAX_TEMPORARY_KEY_URL = "https://api.xmax.ai/open/api/v1/temporary-api-key";
const REACTOR_TOKEN_URL = "https://api.reactor.inc/tokens";
const REACTOR_X2_MODEL = "xmax/x2";

const EDITING_TYPES = new Set([
  "style_transfer",
  "virtual_tryon",
  "subject_replacement",
  "background_replacement",
]);

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function apiKeyFrom(request) {
  return (request.headers.get("Authorization") || "")
    .replace(/^(Token|Bearer)\s+/i, "")
    .trim();
}

export async function createViduSession(request) {
  const requestUrl = new URL(request.url);
  const environment = requestUrl.searchParams.get("env") || "ovs";
  const viduOrigin = VIDU_ORIGINS[environment];
  if (!viduOrigin) {
    return json({ message: "Unknown Vidu environment" }, 400);
  }

  const apiKey = apiKeyFrom(request);
  if (!apiKey.startsWith("vda_")) {
    return json({ message: "A valid Vidu API key is required" }, 401);
  }

  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > 20 * 1024 * 1024) {
    return json({ message: "Request body exceeds 20 MB" }, 413);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ message: "Request body must be valid JSON" }, 400);
  }

  if (!payload || typeof payload.image_url !== "string" || !payload.image_url) {
    return json({ message: "image_url is required" }, 400);
  }
  if (!EDITING_TYPES.has(payload.editing_type)) {
    return json({ message: "Invalid editing_type" }, 400);
  }

  let upstream;
  try {
    upstream = await fetch(`${viduOrigin}/live/s_editing/realtime`, {
      method: "POST",
      headers: {
        Authorization: apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        image_url: payload.image_url,
        editing_type: payload.editing_type,
      }),
    });
  } catch {
    return json({ message: "Could not reach the Vidu API" }, 502);
  }

  const headers = new Headers({
    "Content-Type": upstream.headers.get("Content-Type") || "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  const requestId = upstream.headers.get("X-Request-ID");
  if (requestId) headers.set("X-Request-ID", requestId);

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

export async function proxyViduWebSocket(request) {
  if ((request.headers.get("Upgrade") || "").toLowerCase() !== "websocket") {
    return json({ message: "A WebSocket upgrade is required" }, 426);
  }

  const requestUrl = new URL(request.url);
  const environment = requestUrl.searchParams.get("env") || "ovs";
  const viduOrigin = VIDU_ORIGINS[environment];
  if (!viduOrigin) {
    return json({ message: "Unknown Vidu environment" }, 400);
  }

  const liveId = requestUrl.searchParams.get("live_id");
  const connId = requestUrl.searchParams.get("conn_id");
  const clientSecret = requestUrl.searchParams.get("client_secret");
  if (!liveId || !connId || !clientSecret) {
    return json({ message: "live_id, conn_id, and client_secret are required" }, 400);
  }

  const upstreamUrl = new URL("/live/ws/live/connect", viduOrigin);
  upstreamUrl.searchParams.set("live_id", liveId);
  upstreamUrl.searchParams.set("conn_id", connId);
  upstreamUrl.searchParams.set("client_secret", clientSecret);

  const headers = new Headers(request.headers);
  // Vidu authenticates this connection with client_secret. Do not forward the
  // browser page's cross-origin identity, which some WebSocket gateways reject.
  headers.delete("Origin");

  try {
    return await fetch(upstreamUrl, { headers });
  } catch {
    return json({ message: "Could not reach the Vidu WebSocket" }, 502);
  }
}

export async function createXmaxRealtimeKey(request) {
  const apiKey = apiKeyFrom(request);
  if (!apiKey.startsWith("uk-")) {
    return json({ message: "A valid Xmax permanent API key is required" }, 401);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ message: "Request body must be valid JSON" }, 400);
  }
  const requestedDuration = Math.round(Number(payload?.durationSeconds));
  if (!Number.isFinite(requestedDuration) || requestedDuration < 5 || requestedDuration > 30) {
    return json({ message: "durationSeconds must be between 5 and 30" }, 400);
  }

  let upstream;
  try {
    upstream = await fetch(XMAX_TEMPORARY_KEY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": apiKey,
      },
      body: JSON.stringify({
        expireSeconds: requestedDuration + 120,
        pointsLimit: requestedDuration + 30,
      }),
    });
  } catch {
    return json({ message: "Could not reach the Xmax API" }, 502);
  }

  const responseText = await upstream.text();
  if (!upstream.ok) {
    return new Response(responseText, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") || "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  let responsePayload;
  try {
    responsePayload = JSON.parse(responseText);
  } catch {
    return json({ message: "Xmax returned an invalid response" }, 502);
  }
  const temporaryApiKey = responsePayload?.data?.temporaryApiKey;
  const expireTimestamp = responsePayload?.data?.expireTimestamp;
  if (typeof temporaryApiKey !== "string" || !temporaryApiKey.startsWith("tk-")) {
    return json({ message: "Xmax did not return a temporary API key" }, 502);
  }

  return json({ temporaryApiKey, expireTimestamp });
}

export async function createReactorToken(request) {
  const apiKey = apiKeyFrom(request);
  if (!apiKey.startsWith("rk_")) {
    return json({ message: "A valid Reactor API key is required" }, 401);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ message: "Request body must be valid JSON" }, 400);
  }
  const requestedDuration = Math.round(Number(payload?.durationSeconds));
  if (!Number.isFinite(requestedDuration) || requestedDuration < 5 || requestedDuration > 30) {
    return json({ message: "durationSeconds must be between 5 and 30" }, 400);
  }

  let upstream;
  try {
    upstream = await fetch(REACTOR_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Reactor-API-Key": apiKey,
      },
      body: JSON.stringify({
        expires_after: 300,
        authorization_details: [{
          type: "session",
          resources: { models: { match: [REACTOR_X2_MODEL] } },
          constraints: {
            max_sessions: 1,
            // Leave room for model startup before the browser's output timer starts.
            max_session_duration_seconds: requestedDuration + 120,
          },
        }],
      }),
    });
  } catch {
    return json({ message: "Could not reach the Reactor API" }, 502);
  }

  const responseText = await upstream.text();
  if (!upstream.ok) {
    return new Response(responseText, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") || "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  let responsePayload;
  try {
    responsePayload = JSON.parse(responseText);
  } catch {
    return json({ message: "Reactor returned an invalid response" }, 502);
  }
  if (typeof responsePayload?.jwt !== "string" || !responsePayload.jwt) {
    return json({ message: "Reactor did not return a session token" }, 502);
  }

  return json({ jwt: responsePayload.jwt, expires_at: responsePayload.expires_at });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/session") {
      if (request.method !== "POST") {
        return json({ message: "Method not allowed" }, 405);
      }
      return createViduSession(request);
    }

    if (url.pathname === "/api/vidu/ws") {
      return proxyViduWebSocket(request);
    }

    if (url.pathname === "/api/xmax/realtime-key") {
      if (request.method !== "POST") {
        return json({ message: "Method not allowed" }, 405);
      }
      return createXmaxRealtimeKey(request);
    }

    if (url.pathname === "/api/reactor/token") {
      if (request.method !== "POST") {
        return json({ message: "Method not allowed" }, 405);
      }
      return createReactorToken(request);
    }

    return env.ASSETS.fetch(request);
  },
};
