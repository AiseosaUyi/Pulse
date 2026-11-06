# yt-dlp Instagram Video Resolver Microservice

A tiny, self-contained HTTP service that resolves and downloads Instagram reels/videos using `yt-dlp`. Designed for Render's free plan (512 MB RAM). No Instagram login or cookies required.

## Endpoints

| Method | Path      | Auth Required | Description                          |
|--------|-----------|---------------|--------------------------------------|
| GET    | /health   | No            | Health check — returns ytdlp version |
| POST   | /resolve  | Yes           | Extract metadata (no download)       |
| POST   | /download | Yes           | Stream the video as MP4              |

### GET /health

```bash
curl http://localhost:10000/health
# => {"ok":true,"ytdlp":"2024.xx.x"}
```

### POST /resolve

Returns metadata without downloading. Returns `422` if the post has no video (image-only).

```bash
curl -X POST http://localhost:10000/resolve \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.instagram.com/reel/DdroLq5g5Bk/"}'
# => {"ok":true,"kind":"video","title":"...","duration":30,"uploader":"@user","thumbnail":"https://..."}
```

### POST /download

Streams the video as an MP4 attachment. Best effort: selects DASH video-only + m4a audio, merges via ffmpeg with stream-copy (no re-encode). Hard cap: 100 MB files are rejected (413).

```bash
curl -X POST http://localhost:10000/download \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.instagram.com/reel/DdroLq5g5Bk/"}' \
  -o /tmp/out.mp4

# Verify with ffprobe:
ffprobe /tmp/out.mp4
# => Should show BOTH a video stream AND an audio stream
```

## Error Responses

| Status | Condition                         | Example Response                    |
|--------|-----------------------------------|-------------------------------------|
| 400    | Bad/missing URL, invalid host     | `{"ok":false,"error":"invalid_host"}`|
| 401    | Missing or wrong Authorization    | `{"ok":false,"error":"unauthorized"}`|
| 422    | Post has no video (image-only)    | `{"ok":false,"error":"no_video"}`   |
| 429    | Too many simultaneous downloads   | `{"ok":false,"error":"busy"}`       |
| 502    | yt-dlp extraction failed          | `{"ok":false,"error":"<short msg>"}`|
| 503    | RESOLVER_API_KEY env var unset    | `{"ok":false,"error":"service_unavailable"}`|

## Security Notes

- **SSRF protection**: Only accepts URLs from `instagram.com`, `www.instagram.com`, or `instagr.am` with scheme `https://` and paths starting with `/reel/`, `/reels/`, `/p/`, or `/tv/`.
- No user input is ever passed to a shell. Uses the yt-dlp Python API, not subprocess.
- Authentication via `Authorization: Bearer <RESOLVER_API_KEY>` header.

## Env Vars

| Var              | Required | Default | Description                  |
|------------------|----------|---------|------------------------------|
| `RESOLVER_API_KEY` | Yes    | —       | API key for auth             |
| `PORT`           | No       | 10000   | Listen port (set by Render)  |

## Deploy on Render (Free Plan)

1. Create a new **Web Service** pointing to this repo.
2. **Root Directory**: `services/ytdlp-resolver`
3. **Runtime**: Docker
4. **Instance**: Free (512 MB RAM, 1 CPU core)
5. Add env var: `RESOLVER_API_KEY` = your secret key
6. Click **Manual Deploy** → **Clear build cache & deploy** — Instagram changes often so updating yt-dlp regularly is important.

## Requirements

- Python 3.12+ (slim Docker image)
- `ffmpeg` installed on system (for merging DASH streams)
- `yt-dlp` with Instagram extractor (updated regularly)
