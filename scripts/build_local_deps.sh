#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOCAL_DEPS_DIR="$REPO_ROOT/local-deps"

if [ ! -d "$LOCAL_DEPS_DIR" ]; then
  exit 0
fi

# Build @libp2p/gossipsub
GOSSIPSUB_DIR="$LOCAL_DEPS_DIR/gossipsub"
if [ -d "$GOSSIPSUB_DIR" ] && [ ! -d "$GOSSIPSUB_DIR/dist" ]; then
  echo "Building @libp2p/gossipsub from local-deps..."
  cd "$GOSSIPSUB_DIR"

  # Install deps from npm registry
  npm install --ignore-scripts --no-package-lock 2>/dev/null

  # Build: tsc with skipLibCheck to avoid errors in dependency .d.ts files
  npx tsc -p tsconfig.json --skipLibCheck --declaration --noEmit false

  echo "Successfully built @libp2p/gossipsub"
fi
