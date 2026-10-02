# Vidu S2 Live Editing Demo

A Cloudflare Worker-hosted browser demo for Vidu S2 live video editing. It can send a webcam or uploaded video, preview optional WebGPU selfie segmentation, select bundled character images, and save a side-by-side MP4 of the sent input and received output.

## Architecture

The Worker serves the page and implements one endpoint: `POST /api/session`. Each user supplies their own Vidu API key. The endpoint forwards that key and the session parameters to the selected Vidu API, then returns Vidu's response without storing the key. The browser uses the returned short-lived `client_secret` to connect directly to Vidu's WebSocket and uses AliRTC directly for video.

## Run locally

Requirements:

- Node.js 20 or newer
- A Vidu API key entered in the webpage
- A current WebGPU-capable browser such as Chrome or Edge for background replacement

```sh
npm install
npm run dev
```

Open the local URL printed by Wrangler. Global service endpoints are selected by default.

## Deploy to Cloudflare

Authenticate Wrangler with the Cloudflare account configured in `wrangler.toml`, then deploy:

```sh
npm run deploy
```

Cloudflare serves everything in `public/` and runs `worker/index.js` first for API routes.

## Security

- Local environment files, Wrangler state, and dependencies are ignored by Git.
- The Worker does not log, persist, or bundle Vidu API keys; it only forwards a supplied key during session creation.
- The subsequent browser WebSocket uses Vidu's short-lived `client_secret`, not the API key.
- Never add a real API key to source code, screenshots, issues, or commits.
- If a key is ever committed, revoke it immediately and remove it from Git history.

## Main files

- `public/index.html` — browser UI and live media pipeline
- `public/sample-characters/` — bundled character-picker images
- `worker/index.js` — Vidu session endpoint and static asset handler
- `wrangler.toml` — Cloudflare Worker and asset configuration
