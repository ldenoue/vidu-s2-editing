# Vidu S2 Live Editing Demo

A browser-based demo for Vidu S2 live video editing. It can send a webcam or uploaded video, preview optional WebGPU selfie segmentation before connecting, select character images from URLs, uploads, or the bundled samples, and save a side-by-side MP4 of the sent input and received output.

## Run locally

Requirements:

- Python 3.10 or newer
- A Vidu API key
- A current WebGPU-capable browser such as Chrome or Edge for background replacement

Create your private environment file:

```sh
cp .env.example .env
```

Add your key to `.env`:

```dotenv
VIDU_API_KEY=your_key_here
```

Then start the local server:

```sh
python3 quickstart.py
```

The server opens the demo in your browser and prefills your local key. The browser then contacts Vidu directly. Global service endpoints are selected by default; use `python3 quickstart.py --env cn` if you specifically need the China region.

## GitHub Pages

The static interface is published at [ldenoue.github.io/vidu-s2-editing](https://ldenoue.github.io/vidu-s2-editing/). Every push to `main` deploys through [the Pages workflow](.github/workflows/pages.yml).

The hosted page connects directly to Vidu over HTTPS, WebSocket, and AliRTC. Each user supplies their own API key in the form; the key is kept in that browser session and is not sent through infrastructure operated by this project.

## Security

- `.env` and other local environment variants are ignored by Git.
- `.env.example` documents the required variable without containing a key.
- The GitHub Pages app uses the key only for the direct Vidu session-creation request. The subsequent browser WebSocket uses Vidu's short-lived `client_secret`.
- Never add a real API key to source code, screenshots, issues, or commits.
- If a key is ever committed, revoke it immediately and remove it from Git history.

## Main files

- `index.html` — browser UI and live media pipeline
- `quickstart.py` — optional local static server and convenience launcher
- `sample-characters/` — bundled character-picker images
- `.github/workflows/pages.yml` — GitHub Pages deployment
