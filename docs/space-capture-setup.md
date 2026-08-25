# X Spaces capture — local setup

Extracting a Space's audio needs a logged-in X session and a
long-running download, so this happens locally on your own machine —
Pulse never touches your X login. See `scripts/space-capture/download_space.sh`.

## One-time setup

```bash
brew install yt-dlp ffmpeg whisper-cpp
mkdir -p ~/.whisper-models
curl -L -o ~/.whisper-models/ggml-small.en.bin \
  'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin'
```

(Swap `small.en` for `medium.en` or `large-v3-q5_0` for higher accuracy
at the cost of speed/disk space — `small.en` is a good default for a
30-60min Space on a modern Mac.)

Note: the Homebrew *formula* is named `whisper-cpp`, but the *command*
it installs is `whisper-cli` — the whisper.cpp project renamed its CLI
binary and the formula name never caught up. Run `whisper-cli --help`
to confirm it installed, not `whisper-cpp --help` (that'll say "command
not found" even though the install worked fine).

### Auto-upload into Pulse (optional but recommended)

Create an API token in Pulse under **Settings → Integrations → API
tokens**, scope `content:write`. Then export these once per terminal
session (or add to your shell profile):

```bash
export PULSE_BASE_URL="https://app.yourpulse.example"
export PULSE_API_TOKEN="pulse_ext_..."
```

With those set, the script uploads the finished mp3 (and transcript, if
you generated one) straight into Pulse when it's done — no manual
browser upload step. Without them, the files just stay in
`~/Downloads/twitter-spaces/` for you to upload yourself.

## Per-space capture (free — no API calls for the extraction itself)

```bash
./scripts/space-capture/download_space.sh "https://x.com/i/spaces/<id>" chrome transcribe
```

- 2nd arg is which browser to pull your logged-in X cookies from
  (`chrome`/`firefox`/`edge`/`brave`) — you must already be logged into
  x.com there.
- 3rd arg `transcribe` is optional; add it to also run whisper.cpp
  locally right after download and produce a free `.txt` transcript
  next to the mp3. Omit it to just get the audio file.
- Output: `~/Downloads/twitter-spaces/<title> [<id>].mp3` and, with
  `transcribe`, the matching `.txt`.
- If `PULSE_BASE_URL`/`PULSE_API_TOKEN` are set, the capture appears
  automatically as a generic card in **Content Vault → Saved** (there's
  no dedicated "Spaces" tab/player yet — it's the same list TikTok/IG
  saves land in, with the transcript, if any, in the notes field).
  Without those env vars, there's currently no in-app way to attach a
  file after the fact — the files just stay in
  `~/Downloads/twitter-spaces/` for you to send another way. Setting
  the two env vars is the only path into Pulse right now.

## What "one time" actually means here

The `brew install` setup above is one-time. Running the capture command
is still per-Space — extraction has to happen somewhere with your
logged-in X session and enough runtime to sit through the download, and
that's your machine, not Pulse's server (see the cost/architecture notes
in the original plan doc for why). Auto-upload removes the *manual
upload* step, not the *run the command* step. A fully hands-off
"paste a link inside Pulse itself" version would need an always-on paid
worker (~$7/month) — deliberately not built.
