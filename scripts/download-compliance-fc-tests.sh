#!/usr/bin/env bash
# Download consensus-specs fork-choice compliance test fixtures.
# See `--help` for usage.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT_DIR="$REPO_ROOT/packages/beacon-node/spec-tests"
CACHE_DIR="${LODESTAR_COMPLIANCE_FC_CACHE:-/var/tmp/lodestar_compliance_fc_cache}"
GH_REPO="ethereum/consensus-specs"
GH_WORKFLOW="Compliance Tests"

CONFIG="small"
TARBALL=""
RUN_ID=""

usage() {
  cat <<'EOF'
Usage: download-compliance-fc-tests.sh [options]

Options:
  --config <tiny|small|standard>  Generator config to fetch (default: small)
  --tarball <path>                Use a local .tar.gz file
  --run-id <id>                   Download artifact from a specific GH run id
  --repo <owner/name>             Override consensus-specs repo
  --workflow <name>               Override workflow name
  -h, --help                      Show this help

Output:
  packages/beacon-node/spec-tests/tests/<preset>/<fork>/fork_choice_compliance/

Compliance fixtures live alongside the standard spec-test tarball output;
extraction does not overwrite release-tarball files because the compliance
generator only emits `fork_choice_compliance/` subtrees.

Environment:
  LODESTAR_COMPLIANCE_FC_CACHE  Tarball cache dir
                                (default: /var/tmp/lodestar_compliance_fc_cache)
  GITHUB_TOKEN                  Picked up by `gh` for artifact downloads
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --config)   CONFIG="$2"; shift 2 ;;
    --tarball)  TARBALL="$2"; shift 2 ;;
    --run-id)   RUN_ID="$2"; shift 2 ;;
    --repo)     GH_REPO="$2"; shift 2 ;;
    --workflow) GH_WORKFLOW="$2"; shift 2 ;;
    -h|--help)  usage; exit 0 ;;
    *)          echo "Unknown argument: $1" >&2; usage; exit 1 ;;
  esac
done

case "$CONFIG" in
  tiny|small|standard) ;;
  *) echo "Invalid --config: $CONFIG (must be tiny, small, or standard)" >&2; exit 1 ;;
esac

ARTIFACT_NAME="${CONFIG}.tar.gz"

require_gh() {
  command -v gh >/dev/null 2>&1 || {
    echo "error: 'gh' CLI required for this resolution mode" >&2
    echo "       install from https://cli.github.com or pass --tarball" >&2
    exit 1
  }
}

extract_tarball() {
  local tarball="$1"
  if [[ ! -f "$tarball" ]]; then
    echo "error: tarball not found at $tarball" >&2
    exit 1
  fi
  echo "Extracting $tarball -> $OUTPUT_DIR"
  mkdir -p "$OUTPUT_DIR"
  tar -xzf "$tarball" -C "$OUTPUT_DIR"
}

resolve_latest_run() {
  require_gh
  echo "Resolving latest successful '$GH_WORKFLOW' run on $GH_REPO..." >&2
  gh -R "$GH_REPO" run list \
    --workflow "$GH_WORKFLOW" \
    --status success \
    --limit 1 \
    --json databaseId \
    --jq '.[0].databaseId'
}

download_run_artifact() {
  local run_id="$1"
  require_gh
  local cache_path="$CACHE_DIR/run-$run_id"
  mkdir -p "$cache_path"
  local target="$cache_path/$ARTIFACT_NAME"

  if [[ -f "$target" ]]; then
    echo "Using cached $target" >&2
    printf '%s' "$target"
    return
  fi

  echo "Looking up artifact $ARTIFACT_NAME in run $run_id ($GH_REPO)..." >&2
  # Capture the full listing before selecting the first id: `gh --paginate | head -n1` would
  # kill gh with SIGPIPE once head exits, which pipefail turns into a silent script abort.
  local artifact_ids artifact_id
  artifact_ids=$(gh api "repos/$GH_REPO/actions/runs/$run_id/artifacts" --paginate \
    --jq ".artifacts[] | select(.name == \"$ARTIFACT_NAME\") | .id")
  artifact_id=$(printf '%s\n' "$artifact_ids" | head -n 1)

  if [[ -z "$artifact_id" ]]; then
    echo "error: artifact named '$ARTIFACT_NAME' not found in run $run_id" >&2
    exit 1
  fi

  local raw="$cache_path/raw.bin"
  echo "Downloading artifact id=$artifact_id" >&2
  gh api "repos/$GH_REPO/actions/artifacts/$artifact_id/zip" > "$raw"

  # The artifact may be raw .tar.gz (1f 8b) or zip-wrapped (50 4b "PK").
  local magic
  magic=$(head -c 2 "$raw" | od -An -tx1 | tr -d ' \n')
  case "$magic" in
    504b)
      command -v unzip >/dev/null 2>&1 || {
        echo "error: 'unzip' required to unwrap zip-wrapped artifact" >&2
        exit 1
      }
      echo "Artifact is zip-wrapped, unwrapping..." >&2
      # Unzip into a scratch dir so the tarball search cannot pick up a previously cached
      # tarball of a different config living in the same per-run cache directory.
      local unzip_dir="$cache_path/unzip.$$"
      mkdir -p "$unzip_dir"
      (cd "$unzip_dir" && unzip -o -q "$raw")
      rm -f "$raw"
      local found
      found=$(find "$unzip_dir" -name "$ARTIFACT_NAME" -type f -print -quit || true)
      if [[ -z "$found" ]]; then
        found=$(find "$unzip_dir" -name '*.tar.gz' -type f -print -quit || true)
      fi
      if [[ -z "$found" ]]; then
        echo "error: no .tar.gz found inside zip-wrapped artifact" >&2
        exit 1
      fi
      mv "$found" "$target"
      rm -rf "$unzip_dir"
      ;;
    1f8b)
      echo "Artifact is a raw gzip, using directly." >&2
      mv "$raw" "$target"
      ;;
    *)
      echo "error: unknown artifact format (magic=$magic)" >&2
      exit 1
      ;;
  esac

  printf '%s' "$target"
}

if [[ -n "$TARBALL" ]]; then
  extract_tarball "$TARBALL"
elif [[ -n "$RUN_ID" ]]; then
  TAR_PATH=$(download_run_artifact "$RUN_ID")
  extract_tarball "$TAR_PATH"
else
  RUN_ID=$(resolve_latest_run)
  if [[ -z "$RUN_ID" ]]; then
    echo "error: no successful '$GH_WORKFLOW' runs found on $GH_REPO" >&2
    exit 1
  fi
  echo "Latest successful run: $RUN_ID"
  TAR_PATH=$(download_run_artifact "$RUN_ID")
  extract_tarball "$TAR_PATH"
fi

echo "Done."
