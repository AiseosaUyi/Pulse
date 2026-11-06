from __future__ import annotations

import hmac
import json
import os
import re
import shutil
import tempfile
import time
from pathlib import Path
from typing import Any, Generator, Iterator

import yt_dlp as ytdl
from flask import Flask, Response, request
from werkzeug.exceptions import HTTPException

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------
app = Flask(__name__)

try:
    from gevent.semaphore import Semaphore
except ImportError:  # gevent might not be installed in dev env; use stdlib fallback
    import threading as _threading
    Semaphore = _threading.Semisphere if False else _threading.Semaphore  # type: ignore[misc,name-defined]

ALLOWED_HOSTS = {"instagram.com", "www.instagram.com", "instagr.am"}
VIDEO_PATH_PREFIXES = ("/reel/", "/reels/", "/p/", "/tv/")

API_KEY: str | None = os.environ.get("RESOLVER_API_KEY") or None

download_sem = Semaphore(2)  # max 2 simultaneous downloads


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _check_auth() -> Response | None:
    """Require Bearer token; return 401/503 Response if missing."""
    if API_KEY is None:
        return Response(
            json.dumps({"ok": False, "error": "service_unavailable"}),
            status=503,
            content_type="application/json",
        )
    auth = request.headers.get("Authorization", "")
    expected = f"Bearer {API_KEY}"
    if not auth or not hmac.compare_digest(auth, expected):
        return Response(
            json.dumps({"ok": False, "error": "unauthorized"}),
            status=401,
            content_type="application/json",
        )
    return None


def _validate_url(raw: Any) -> tuple[str | None, Response | None]:
    """Validate URL field. Return (clean_url_string, error_response)."""
    from urllib.parse import urlparse as _urlparse

    if raw is None or not isinstance(raw, str):
        return None, Response(
            json.dumps({"ok": False, "error": "missing_url"}),
            status=400,
            content_type="application/json",
        )
    url = raw.strip()
    if not url:
        return None, Response(
            json.dumps({"ok": False, "error": "empty_url"}),
            status=400,
            content_type="application/json",
        )

    parsed = _urlparse(url)

    if parsed.scheme != "https":
        return None, Response(
            json.dumps({"ok": False, "error": "https_only"}),
            status=400,
            content_type="application/json",
        )
    if parsed.hostname is None or parsed.hostname.lower() not in ALLOWED_HOSTS:
        return None, Response(
            json.dumps({"ok": False, "error": "invalid_host"}),
            status=400,
            content_type="application/json",
        )
    # Instagram shortcodes are case-sensitive: never lowercase the path we
    # forward. Only the prefix check is case-insensitive, and the whole path
    # must be exactly /<kind>/<shortcode>/ so nothing else can ride along.
    path_str = parsed.path
    if not any(path_str.lower().startswith(prefix) for prefix in VIDEO_PATH_PREFIXES) or not re.fullmatch(
        r"/(?:reel|reels|p|tv)/[A-Za-z0-9_-]+/?", path_str, flags=re.IGNORECASE
    ):
        return None, Response(
            json.dumps({"ok": False, "error": "invalid_path"}),
            status=400,
            content_type="application/json",
        )

    # Strip query string before passing to yt-dlp
    clean_url = f"{parsed.scheme}://{parsed.hostname}{path_str}"
    return clean_url, None


def _ytdlp_opts() -> dict[str, Any]:
    """Default yt-dlp options (metadata extraction only)."""
    return {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": False,
        "download": False,
        "max_filesize": 100 * 1024 * 1024,  # 100 MB hard cap
        "format": "best",
    }


def _ytdlp_dl_opts() -> dict[str, Any]:
    """Options for actual downloading (for /download endpoint)."""
    return {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": False,
        # Always merge a video stream WITH an audio stream. Instagram serves
        # DASH video-only + audio-only, and which codecs exist varies by
        # server region (Render's IP gets VP9 only, no H.264). The old string
        # fell through to a bare "b[ext=mp4]" that picked video-only VP9 and
        # produced a silent file. Sort prefers H.264 when offered, caps at 1080p.
        "format": "bv*+ba/b",
        "format_sort": ["vcodec:h264", "res:1080", "ext:mp4:m4a"],
        "merge_output_format": "mp4",
        "max_filesize": 100 * 1024 * 1024,
    }


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.route("/health", methods=["GET"])
def health():
    import yt_dlp as _ytdl
    return Response(
        json.dumps({"ok": True, "ytdlp": _ytdl.version.__version__}),
        status=200,
        content_type="application/json",
    )


@app.route("/resolve", methods=["POST"])
def resolve():
    """Resolve an Instagram URL to metadata (no download)."""
    auth_resp = _check_auth()
    if auth_resp:
        return auth_resp

    try:
        body = request.get_json(force=False, silent=True)
    except Exception:
        body = None
    if not isinstance(body, dict):
        return Response(
            json.dumps({"ok": False, "error": "bad_json"}),
            status=400,
            content_type="application/json",
        )

    raw_url = body.get("url")
    clean_url, err = _validate_url(raw_url)
    if err:
        return err

    try:
        opts = _ytdlp_opts()
        with ytdl.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(clean_url, download=False)
    except HTTPException as exc:
        msg = str(exc).split("\n")[0][:120]
        return Response(
            json.dumps({"ok": False, "error": msg}),
            status=502,
            content_type="application/json",
        )
    except Exception as exc:
        msg = str(exc).split("\n")[0][:120]
        return Response(
            json.dumps({"ok": False, "error": msg}),
            status=502,
            content_type="application/json",
        )

    if info is None or not isinstance(info, dict):
        return Response(
            json.dumps({"ok": False, "error": "no_info"}),
            status=422,
            content_type="application/json",
        )

    # Check for video — Instagram posts may be image-only
    formats = info.get("formats")
    has_video = False
    if isinstance(formats, list):
        for f in formats:
            if isinstance(f, dict) and f.get("vcodec") is not None:
                has_video = True
                break

    if not has_video:
        return Response(
            json.dumps({"ok": False, "error": "no_video"}),
            status=422,
            content_type="application/json",
        )

    duration = info.get("duration")
    title = info.get("title") or ""
    uploader = info.get("uploader") or None
    thumbnail = info.get("thumbnail") or None

    return Response(
        json.dumps({
            "ok": True,
            "kind": "video",
            "title": title,
            "duration": duration if isinstance(duration, (int, float)) else None,
            "uploader": uploader,
            "thumbnail": thumbnail,
        }),
        status=200,
        content_type="application/json",
    )


@app.route("/download", methods=["POST"])
def download():
    """Download the Instagram video as a streamed MP4."""
    auth_resp = _check_auth()
    if auth_resp:
        return auth_resp

    try:
        body = request.get_json(force=False, silent=True)
    except Exception:
        body = None
    if not isinstance(body, dict):
        return Response(
            json.dumps({"ok": False, "error": "bad_json"}),
            status=400,
            content_type="application/json",
        )

    raw_url = body.get("url")
    clean_url, err = _validate_url(raw_url)
    if err:
        return err

    # Concurrency guard — non-blocking
    acquired = download_sem.acquire(timeout=0)
    if not acquired:
        return Response(
            json.dumps({"ok": False, "error": "busy"}),
            status=429,
            content_type="application/json",
        )

    tmp_dir = Path(tempfile.mkdtemp(prefix="yt_resolver_"))

    def stream_generator() -> Generator[bytes, None, None]:
        """Yield file chunks then clean up temp dir."""
        file_path: Path | None = None
        try:
            opts = _ytdlp_dl_opts()
            opts["outtmpl"] = str(tmp_dir / "%(id)s.%(ext)s")
            with ytdl.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(clean_url, download=True)

            if info is None or not isinstance(info, dict):
                yield json.dumps({"ok": False, "error": "no_info"}).encode()
                return

            # Find the downloaded .mp4 file
            candidates = list(tmp_dir.glob("*.mp4"))
            if not candidates:
                yield json.dumps({"ok": False, "error": "file_not_found"}).encode()
                return

            file_path = candidates[0]
            file_size = file_path.stat().st_size

            # Hard cap double-check
            if file_size > 100 * 1024 * 1024:
                yield json.dumps({"ok": False, "error": "file_too_large"}).encode()
                return

            with open(file_path, "rb") as fh:
                while True:
                    chunk = fh.read(64 * 1024)
                    if not chunk:
                        break
                    yield chunk
        finally:
            # Always clean up the temp directory
            try:
                shutil.rmtree(tmp_dir, ignore_errors=True)
            except Exception:
                pass

    def error_generator(msg: str) -> Generator[bytes, None, None]:
        yield json.dumps({"ok": False, "error": msg}).encode()

    # Wrap to release semaphore and handle download errors
    def combined() -> Generator[bytes, None, None]:
        try:
            yield from stream_generator()
        except Exception as exc:
            yield json.dumps({"ok": False, "error": str(exc)[:120]}).encode()
        finally:
            download_sem.release()

    return Response(
        combined(),
        status=200,
        content_type="video/mp4",
    )


# ---------------------------------------------------------------------------
# Error handling
# ---------------------------------------------------------------------------

@app.errorhandler(404)
def not_found(_e):
    return Response(
        json.dumps({"ok": False, "error": "not_found"}),
        status=404,
        content_type="application/json",
    )


@app.errorhandler(405)
def method_not_allowed(_e):
    return Response(
        json.dumps({"ok": False, "error": "method_not_allowed"}),
        status=405,
        content_type="application/json",
    )


# ---------------------------------------------------------------------------
# CLI entry point (for running without gunicorn in dev)
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 10000))
    app.run(host="0.0.0.0", port=port, debug=False)
