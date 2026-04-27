#!/usr/bin/env bash
#
# Run the consensus-specs fork-choice compliance suite against Lodestar and
# print a per-suite total/pass/fail/skip table plus overall totals.
#
# Wraps download-compliance-fc-tests.sh + vitest + jq, mirroring the shape of
# Prysm's hack/compliance-fc-report.sh.
#
# Usage:
#   ./scripts/compliance-fc-report.sh                      # auto-fetch small + run minimal
#   ./scripts/compliance-fc-report.sh --preset mainnet
#   ./scripts/compliance-fc-report.sh --no-download
#   ./scripts/compliance-fc-report.sh --tarball ~/Downloads/small.tar.gz
#   ./scripts/compliance-fc-report.sh --run-id 24754336017
#
# Requires: pnpm, jq, and `gh` only when auto-fetching artifacts.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

CONFIG="small"
PRESET="minimal"
DOWNLOAD=1
DOWNLOAD_ARGS=()
JSON_OUT=""

usage() {
  cat <<'EOF'
Usage: compliance-fc-report.sh [options]

Options:
  --config <tiny|small|standard>  Generator config (default: small)
  --preset <minimal|mainnet>      Spec preset / vitest project (default: minimal)
  --no-download                   Skip the download step (use existing data)
  --tarball <path>                Pass through to downloader
  --url <url>                     Pass through to downloader
  --run-id <id>                   Pass through to downloader
  --dir <path>                    Pass through to downloader
  --json-out <path>               Persist the raw vitest JSON (default: tmp file)
  -h, --help                      Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --config)       CONFIG="$2"; shift 2 ;;
    --preset)       PRESET="$2"; shift 2 ;;
    --no-download)  DOWNLOAD=0; shift ;;
    --tarball|--url|--run-id|--dir)
                    DOWNLOAD_ARGS+=("$1" "$2"); shift 2 ;;
    --json-out)     JSON_OUT="$2"; shift 2 ;;
    -h|--help)      usage; exit 0 ;;
    *)              echo "Unknown argument: $1" >&2; usage; exit 1 ;;
  esac
done

case "$CONFIG" in
  tiny|small|standard) ;;
  *) echo "Invalid --config: $CONFIG" >&2; exit 1 ;;
esac
case "$PRESET" in
  minimal|mainnet) ;;
  *) echo "Invalid --preset: $PRESET" >&2; exit 1 ;;
esac

command -v jq >/dev/null    || { echo "error: jq is required" >&2; exit 1; }
command -v pnpm >/dev/null  || { echo "error: pnpm is required" >&2; exit 1; }

if [[ "$DOWNLOAD" -eq 1 ]]; then
  echo "==> Downloading compliance test data ($CONFIG)"
  "$SCRIPT_DIR/download-compliance-fc-tests.sh" \
    --config "$CONFIG" \
    ${DOWNLOAD_ARGS[@]+"${DOWNLOAD_ARGS[@]}"}
fi

if [[ -z "$JSON_OUT" ]]; then
  JSON_OUT="${TMPDIR:-/tmp}/compliance-fc-$$.json"
fi

echo "==> Running compliance suite (project=spec-$PRESET, json=$JSON_OUT)"
cd "$REPO_ROOT"
# 8GB heap: ~3000 tests each spin up a BeaconChain; default heap OOMs the worker
# mid-run, leaving every test recorded as `pending` in the JSON.
export NODE_OPTIONS="${NODE_OPTIONS:-} --max-old-space-size=8192"
# Vitest exits non-zero on any failing test — expected for this suite. Continue.
pnpm vitest run \
  --project "spec-$PRESET" \
  --reporter=default --reporter=json \
  --outputFile.json="$JSON_OUT" \
  packages/beacon-node/test/spec/presets/compliance_fork_choice.test.ts \
  || true

if [[ ! -s "$JSON_OUT" ]]; then
  echo "error: vitest produced no JSON output at $JSON_OUT" >&2
  exit 1
fi

TOTAL=$(jq '[ .testResults[].assertionResults[] ] | length' "$JSON_OUT")
if [[ "$TOTAL" -eq 0 ]]; then
  echo "No tests collected. Did you download the test data? (--no-download was set or extraction was empty)"
  exit 1
fi

# `pending` = vitest's marker for tests that were never executed (worker crash,
# timeout, or the run was interrupted). `skipped` = `it.skip` deliberately. Keep
# them in distinct columns so a worker crash doesn't masquerade as a clean skip.
echo
echo "==> Per-suite results"
jq -r '
  [ .testResults[].assertionResults[] ]
  | group_by(.ancestorTitles[0])
  | map({
      suite: (.[0].ancestorTitles[0] // "<unknown>"),
      total:   length,
      pass:    (map(select(.status=="passed"))  | length),
      fail:    (map(select(.status=="failed"))  | length),
      skip:    (map(select(.status=="skipped")) | length),
      pending: (map(select(.status=="pending")) | length)
    })
  | (["SUITE","TOTAL","PASS","FAIL","SKIP","PENDING"] | @tsv),
    (.[] | [.suite, (.total|tostring), (.pass|tostring), (.fail|tostring), (.skip|tostring), (.pending|tostring)] | @tsv)
' "$JSON_OUT" | column -t -s $'\t'

echo
echo "==> Overall"
jq -r '
  [ .testResults[].assertionResults[] ] as $a
  | "Total:   \($a | length)\nPassed:  \($a | map(select(.status=="passed")) | length)\nFailed:  \($a | map(select(.status=="failed")) | length)\nSkipped: \($a | map(select(.status=="skipped")) | length)\nPending: \($a | map(select(.status=="pending")) | length)"
' "$JSON_OUT"

PENDING_COUNT=$(jq '[ .testResults[].assertionResults[] | select(.status=="pending") ] | length' "$JSON_OUT")
if [[ "$PENDING_COUNT" -gt 0 ]]; then
  echo
  echo "WARNING: $PENDING_COUNT tests were never executed (status=pending)."
  echo "         This usually means the vitest worker crashed (e.g. OOM) before"
  echo "         these tests ran. Check the run output above for stack traces."
fi

FAIL_COUNT=$(jq '[ .testResults[].assertionResults[] | select(.status=="failed") ] | length' "$JSON_OUT")
if [[ "$FAIL_COUNT" -gt 0 ]]; then
  echo
  echo "==> Failed tests grouped by error message (top 20 groups)"
  jq -r '
    [ .testResults[].assertionResults[] | select(.status=="failed") ]
    | group_by(.failureMessages[0] // "<no message>")
    | sort_by(-length)
    | .[0:20]
    | .[]
    | "  \(length)x  \((.[0].failureMessages[0] // "") | split("\n")[0] | .[0:160])\n         e.g. \(.[0].title)"
  ' "$JSON_OUT"
  echo
  echo "Full list of $FAIL_COUNT failures available in: $JSON_OUT"
fi

echo
echo "Raw JSON: $JSON_OUT"
