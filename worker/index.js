const VIDU_ORIGINS = {
  cn: "https://api.vidu.cn",
  ovs: "https://api.vidu.com",
};

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

    return env.ASSETS.fetch(request);
  },
};
