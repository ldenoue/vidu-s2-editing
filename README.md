# Realtime Video Editing Demo

A Cloudflare Worker-hosted browser demo for Vidu S2 and Decart Lucy 2.5 live video editing. It can send a webcam or uploaded video, preview optional WebGPU selfie segmentation, select bundled character images, and save a side-by-side MP4 of the sent input and received output.

## Architecture

The Worker serves the page and implements `POST /api/session` for Vidu. Each user supplies their own provider key, retained separately in that browser's local storage for convenience.

- Vidu session creation is forwarded through the Worker; the browser then uses the returned short-lived credential with Vidu's WebSocket and AliRTC.
- Decart uses the official fal.ai browser client for signaling and a peer-to-peer WebRTC media connection to `decart/lucy-2-5/realtime`.

## Run locally

Requirements:

- Node.js 20 or newer
- A Vidu or fal.ai API key entered in the webpage
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
- Vidu and fal.ai keys are persisted separately in the current browser's local storage and can be removed by clearing the API-key field.
- The Worker does not log, persist, or bundle Vidu API keys; it only forwards a supplied key during session creation.
- The subsequent browser WebSocket uses Vidu's short-lived `client_secret`, not the API key.
- Never add a real API key to source code, screenshots, issues, or commits.
- If a key is ever committed, revoke it immediately and remove it from Git history.

## Main files

- `public/index.html` — browser UI and live media pipeline
- `public/sample-characters/` — bundled character-picker images
- `worker/index.js` — Vidu session endpoint and static asset handler
- `wrangler.toml` — Cloudflare Worker and asset configuration
