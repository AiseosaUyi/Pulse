# Dockerfile — ytdlp-resolver microservice
# Built for Render free plan: 512 MB RAM, 1 CPU core
# Uses Python slim + ffmpeg nodejs ca-certificates minimal install
FROM python:3.12-slim

# Install system dependencies (ffmpeg for merging DASH streams)
# Clean apt lists to keep image small
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ffmpeg \
        nodejs \
        ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps first (layer caching)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY app.py .

# Render sets PORT via environment variable; default 10000
# Shell form via sh -c so ${PORT} is actually expanded (exec-form CMD does not).
CMD ["sh", "-c", "exec gunicorn -b 0.0.0.0:${PORT:-10000} --workers=1 --threads=4 --timeout=120 app:app"]
