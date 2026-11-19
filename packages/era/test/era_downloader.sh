#!/bin/bash

# Copyright (c) 2025 Status Research & Development GmbH. Licensed under
# either of:
# - Apache License, version 2.0
# - MIT license
# at your option. This file may not be copied, modified, or distributed except
# according to those terms.

# Usage:
#  - chmod +x era_downloader.sh
#  - ./era_downloader.sh            # downloads mainnet-01506-4781865b.era into this test directory
#  - ./era_downloader.sh <file_url> # downloads the provided file into this test directory
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DOWNLOAD_DIR="$SCRIPT_DIR"

if [ $# -eq 0 ]; then
  DOWNLOAD_URL="https://mainnet.era.nimbus.team/mainnet-01506-4781865b.era"
elif [ $# -eq 1 ]; then
  DOWNLOAD_URL="$1"
else
  echo "Usage: $0 [file_url]"
  exit 1
fi

if ! command -v aria2c > /dev/null 2>&1; then
  echo "❌ aria2c is not installed. Install via: brew install aria2 (macOS) or sudo apt install aria2 (Linux)"
  exit 1
fi

mkdir -p "$DOWNLOAD_DIR"

FILE_NAME=$(basename "$DOWNLOAD_URL")

echo "📥 Downloading $FILE_NAME to $DOWNLOAD_DIR ..."
aria2c -x 8 -c -o "$FILE_NAME" \
  --dir="$DOWNLOAD_DIR" \
  --console-log-level=warn \
  --quiet=true \
  --summary-interval=0 \
  "$DOWNLOAD_URL"

echo "✅ Downloaded: $DOWNLOAD_DIR/$FILE_NAME"
