#!/usr/bin/env bash
#
# download_space.sh — Free, local Twitter/X Spaces audio downloader
#
# Uses yt-dlp (open source, MIT-licensed) + ffmpeg (open source). No paid
# API, no third-party service, no key required. This is the same underlying
# mechanism tools like Flowjin, xspace-dl, twspace-dl, etc. are built on:
#   1. Load the Space page and pull out its media_key / stream metadata
#      via X's own web API (the same calls your browser makes).
#   2. Resolve that to the HLS (.m3u8) playlist URL for the audio stream.
#   3. Download the HLS chunks and remux/convert them into a single
#      audio file with ffmpeg.
#
# yt-dlp already implements steps 1-3 natively (extractor: "twitter:spaces"),
# so this script is just a thin, convenient wrapper around it.
#
# REQUIREMENTS (all free):
#   - Python 3 + pip
#   - yt-dlp        -> pip install -U yt-dlp
#   - ffmpeg        -> brew install ffmpeg   (macOS)  /  apt install ffmpeg (Linux)
#   - A browser on this machine logged into x.com/Twitter.
#     (X requires a logged-in session to read Space data — guest access
#     was disabled in mid-2023 — so we borrow your existing browser
#     cookies instead of ever touching your password.)
#
# USAGE:
#   ./download_space.sh "https://x.com/i/spaces/1abcXYZdefGHI" [browser] [transcribe]
#
#   1st arg: the Space URL (required).
#   2nd arg: which browser to pull cookies from — chrome/firefox/edge/brave
#            (default: chrome). Make sure you're logged into x.com there.
#   3rd arg: pass "transcribe" to also run whisper.cpp locally afterward
#            (free, no API call) — see docs/space-capture-setup.md.
#
# AUTO-UPLOAD TO PULSE (optional):
#   Set PULSE_BASE_URL and PULSE_API_TOKEN (create a token in Pulse under
#   Settings → Integrations → API tokens, scope: content:write) and the
#   script pushes the finished mp3 (+ transcript, if produced) straight
#   into Pulse's Content Vault → Saved when it's done (as a generic
#   saved_content card — no dedicated Spaces UI yet). Without those env
#   vars set, the script just leaves the files in OUT_DIR — there's
#   currently no other way to get them into Pulse.
#
#     export PULSE_BASE_URL="https://app.yourpulse.example"
#     export PULSE_API_TOKEN="pulse_ext_..."
#     ./download_space.sh "https://x.com/i/spaces/..." chrome transcribe

set -euo pipefail

WAV_PATH=""
cleanup() {
  if [[ -n "${WAV_PATH:-}" && -f "$WAV_PATH" ]]; then
    rm -f "$WAV_PATH"
  fi
}
trap cleanup EXIT

SPACE_URL="${1:-}"
BROWSER="${2:-chrome}"
DO_TRANSCRIBE="${3:-}"

if [[ -z "$SPACE_URL" ]]; then
  echo "Usage: $0 <twitter-space-url> [browser] [transcribe]"
  echo "Example: $0 https://x.com/i/spaces/1abcXYZdefGHI chrome transcribe"
  exit 1
fi

if ! command -v yt-dlp >/dev/null 2>&1; then
  echo "yt-dlp not found. Install it with: pip install -U yt-dlp"
  exit 1
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg not found. Install it with: brew install ffmpeg (macOS) or apt install ffmpeg (Linux)"
  exit 1
fi

OUT_DIR="${OUT_DIR:-$HOME/Downloads/twitter-spaces}"
mkdir -p "$OUT_DIR"

WHISPER_MODEL="${WHISPER_MODEL:-$HOME/.whisper-models/ggml-small.en.bin}"

echo "Downloading Space: $SPACE_URL"
echo "Using cookies from: $BROWSER"
echo "Output folder: $OUT_DIR"
echo

# NOTE: deliberately not using --exec here. --exec runs its command
# through the shell with the filename spliced in as text, and the
# filename is templated from the Space's title/uploader — attacker-
# controlled strings we don't own. A title containing backticks/`;`/`$()`
# would be shell-injected on your own machine. --print after_move:filepath
# instead prints the final (post-conversion) path straight to our stdout
# capture, no second shell invocation involved.
LATEST_MP3=$(yt-dlp \
  --cookies-from-browser "$BROWSER" \
  -x --audio-format mp3 --audio-quality 0 \
  --write-info-json \
  -o "$OUT_DIR/%(uploader)s - %(title)s [%(id)s].%(ext)s" \
  --print after_move:filepath \
  "$SPACE_URL")

if [[ -z "$LATEST_MP3" || ! -f "$LATEST_MP3" ]]; then
  echo "yt-dlp didn't report a final output path — download may have failed."
  exit 1
fi
INFO_JSON="${LATEST_MP3%.mp3}.info.json"
TXT_PATH="${LATEST_MP3%.mp3}.txt"

echo
echo "Done: $LATEST_MP3"

# ── Optional local transcription (free, no API call) ──────────────────
# Uses whisper.cpp: open source, runs on your own Mac (Metal-accelerated
# on Apple Silicon) — vs. $0.006/min for OpenAI Whisper or ~$0.000667/min
# even on Groq's cheaper hosted Whisper. One-time setup is in
# docs/space-capture-setup.md.
if [[ "$DO_TRANSCRIBE" == "transcribe" ]]; then
  # Note: the Homebrew formula is "whisper-cpp" but the installed
  # command is "whisper-cli" — the whisper.cpp project renamed its CLI
  # binary; the formula name never caught up. `brew list whisper-cpp`
  # will show you whisper-cli among the installed files if in doubt.
  if ! command -v whisper-cli >/dev/null 2>&1; then
    echo
    echo "transcribe requested but whisper-cli isn't installed."
    echo "Install it with: brew install whisper-cpp   (yes — formula name differs from the command name)"
    exit 1
  fi
  if [[ ! -f "$WHISPER_MODEL" ]]; then
    echo
    echo "Model not found at $WHISPER_MODEL"
    echo "Download one with, e.g.:"
    echo "  mkdir -p ~/.whisper-models && curl -L -o \"$WHISPER_MODEL\" \\"
    echo "    'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin'"
    exit 1
  fi

  echo
  echo "Transcribing locally (free, no API call): $LATEST_MP3"
  WAV_PATH="${LATEST_MP3%.mp3}.wav"
  ffmpeg -y -loglevel error -i "$LATEST_MP3" -ar 16000 -ac 1 "$WAV_PATH"
  whisper-cli -m "$WHISPER_MODEL" -f "$WAV_PATH" --output-txt -of "${LATEST_MP3%.mp3}"
  echo "Transcript: $TXT_PATH"
fi

# ── Optional auto-upload into Pulse ────────────────────────────────────
# Requires PULSE_BASE_URL + PULSE_API_TOKEN env vars. Talks to Pulse's
# /api/v1/spaces endpoint (token scope: content:write) — see
# docs/space-capture-setup.md for how to create a token.
if [[ -n "${PULSE_BASE_URL:-}" && -n "${PULSE_API_TOKEN:-}" ]]; then
  if ! command -v python3 >/dev/null 2>&1; then
    echo
    echo "Auto-upload needs python3 (used to build/parse JSON) — not found. Skipping upload."
    exit 0
  fi

  echo
  echo "Uploading to Pulse: $PULSE_BASE_URL"

  REQUEST_BODY=$(python3 - "$INFO_JSON" "$SPACE_URL" "$TXT_PATH" <<'PY'
import json, sys

info_path, space_url, txt_path = sys.argv[1], sys.argv[2], sys.argv[3]

with open(info_path, encoding="utf-8") as f:
    info = json.load(f)

transcript = None
try:
    with open(txt_path, encoding="utf-8") as f:
        transcript = f.read().strip() or None
except FileNotFoundError:
    pass

raw_duration = info.get("duration")  # yt-dlp reports this as a float; Pulse wants a whole-second int
duration_s = int(round(raw_duration)) if isinstance(raw_duration, (int, float)) else None

body = {
    "spaceUrl": space_url,
    "title": info.get("title") or "Untitled Space",
    "hostHandle": info.get("uploader"),
    "durationS": duration_s,
    "transcript": transcript,
}
print(json.dumps(body))
PY
  )

  INIT_RESPONSE=$(curl -fsS --max-time 30 -X POST "$PULSE_BASE_URL/api/v1/spaces" \
    -H "Authorization: Bearer $PULSE_API_TOKEN" \
    -H "Content-Type: application/json" \
    -d "$REQUEST_BODY")

  CAPTURE_ID=$(echo "$INIT_RESPONSE" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('captureId',''))")
  UPLOAD_URL=$(echo "$INIT_RESPONSE" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('uploadUrl',''))")

  if [[ -z "$CAPTURE_ID" || -z "$UPLOAD_URL" ]]; then
    echo "Pulse didn't return an upload URL — response was:"
    echo "$INIT_RESPONSE"
    echo "Files are still on disk at $LATEST_MP3."
    exit 1
  fi

  curl -fsS --max-time 900 -X PUT -H "Content-Type: audio/mpeg" --data-binary @"$LATEST_MP3" "$UPLOAD_URL" >/dev/null

  curl -fsS --max-time 30 -X POST "$PULSE_BASE_URL/api/v1/spaces/$CAPTURE_ID/complete" \
    -H "Authorization: Bearer $PULSE_API_TOKEN" >/dev/null

  echo "Uploaded. Check Pulse → Content Vault → Saved."
else
  echo
  echo "Tip: set PULSE_BASE_URL + PULSE_API_TOKEN to auto-upload into Pulse next time."
  echo "     For now, $LATEST_MP3 stays right here on disk."
fi
