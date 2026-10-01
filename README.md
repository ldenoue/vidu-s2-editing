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

The server opens the demo in your browser. Global service endpoints are selected by default; use `python3 quickstart.py --env cn` if you specifically need the China region.

## GitHub Pages

The static interface is published at [ldenoue.github.io/vidu-s2-editing](https://ldenoue.github.io/vidu-s2-editing/). Every push to `main` deploys through [the Pages workflow](.github/workflows/pages.yml).

GitHub Pages cannot run the Python reverse proxy. The hosted page is therefore useful for viewing and testing the interface, but authenticated Vidu connections should be run locally with `quickstart.py`. The API key is not included in the Pages artifact or committed to this repository.

## Security

- `.env` and other local environment variants are ignored by Git.
- `.env.example` documents the required variable without containing a key.
- Never add a real API key to source code, screenshots, issues, or commits.
- If a key is ever committed, revoke it immediately and remove it from Git history.

## Main files

- `index.html` — browser UI and live media pipeline
- `quickstart.py` — local static server and authenticated Vidu HTTP/WebSocket proxy
- `sample-characters/` — bundled character-picker images
- `.github/workflows/pages.yml` — GitHub Pages deployment
