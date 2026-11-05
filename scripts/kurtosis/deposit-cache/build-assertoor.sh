#!/usr/bin/env bash
# Build the pinned stress generator for the host architecture, without its optional web UI.
# Usage: build-assertoor.sh [image tag]
set -euo pipefail

IMAGE=${1:-local/assertoor:deposit-cache-f588c88b}
BUILD_DIR=$(mktemp -d /tmp/lodestar-assertoor.XXXXXX)
trap 'rm -rf "$BUILD_DIR"' EXIT
gh api repos/jtraglia/assertoor/tarball/f588c88bee10b12af0400fd716571bb6ab7eb418 > "$BUILD_DIR/source.tar.gz"
mkdir "$BUILD_DIR/source" "$BUILD_DIR/image"
tar -xzf "$BUILD_DIR/source.tar.gz" --strip-components=1 -C "$BUILD_DIR/source"
printf '%s\n' '<!doctype html><title>Assertoor stress runner</title><p>Use the API and service logs for this run.</p>' > "$BUILD_DIR/source/pkg/web/static/index.html"
(
  cd "$BUILD_DIR/source"
  GOTOOLCHAIN=go1.25.7 go build -buildvcs=false -ldflags=-s -o "$BUILD_DIR/image/assertoor" .
)
cat > "$BUILD_DIR/image/Dockerfile" <<'EOF'
FROM node:24.22.1@sha256:d862bb5d082c5ae0210ac07e8c0344cb8cf7bef6d78e9b8c50c179da923108ea
COPY assertoor /app/assertoor
ENTRYPOINT ["/app/assertoor"]
EOF
docker build -t "$IMAGE" "$BUILD_DIR/image"
