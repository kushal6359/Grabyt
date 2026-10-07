# Grab

A small YouTube video/audio downloader: a static frontend (`index.html`) and a
Node/Express backend (`backend/`) that runs `yt-dlp` + `ffmpeg`.

## Run it on your own computer (most reliable)

YouTube blocks most cloud/datacenter IPs (Render, Railway, AWS...) with
403 / 429 / "Sign in to confirm you're not a bot". A home connection is not
blocked, so this is the setup that works best.

Requirements: Node 20+, `ffmpeg`, `yt-dlp` (`pip install -U --pre "yt-dlp[default]"`).

```bash
cd backend
npm install
node server.js
# open http://localhost:3000
```

The backend serves `index.html` itself and the page talks to the same server
automatically.

## Deploy on Render (Docker)

Root directory: `backend`, runtime: Docker. Optional environment variables:

| Variable | What it does |
|---|---|
| `YTDLP_COOKIES_B64` | base64 of a `cookies.txt` from a YouTube session. Fixes most "not a bot" errors on cloud hosts. |
| `YTDLP_PROXY` | e.g. `http://user:pass@host:port` – route yt-dlp through a proxy you control. |
| `YTDLP_PLAYER_CLIENT` | Pin one yt-dlp player client list (default: try default, then `tv,web_safari`, then `android_vr`). |
| `MAX_ACTIVE_DOWNLOADS` | Concurrent downloads (default 2; keep low on small servers). |
| `AUTO_UPDATE_YTDLP` | `1` (default in the Dockerfile) updates yt-dlp on every boot. |

### Cookies

1. In a private window, sign in to YouTube (use a spare account – automated use
   of an account can get it flagged), open youtube.com/robots.txt, and export
   cookies with a "cookies.txt" browser extension. Close the window.
2. `base64 -w0 cookies.txt` → paste into `YTDLP_COOKIES_B64` on Render.

Check `https://<your-backend>/api/health` – it reports the yt-dlp version,
whether ffmpeg is found and whether cookies are loaded.

## Notes

- Only download videos you own, that are licensed for it, or that you otherwise
  have permission to save. Downloading from YouTube may breach its Terms of Service.
- Files are kept for 30 minutes on the server, then deleted.
