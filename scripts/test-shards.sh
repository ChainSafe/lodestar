#!/usr/bin/env bash
# Compiles a test step once, then runs its tests as parallel shards of the compiled binary.
# The step must use test/test_runner.zig. Each run records test durations under
# .zig-cache/test-shards/<step>/, and the next run balances its shards by them.
#
# usage: scripts/test-shards.sh <step> [shards] [--filter=<substring> ...]
set -euo pipefail
shopt -s nullglob

usage="usage: scripts/test-shards.sh <step> [shards] [--filter=<substring> ...]"
step=${1:?$usage}
shift
shards=$(($(nproc) < 16 ? $(nproc) : 16))
if [[ $# -gt 0 && $1 != --* ]]; then
  shards=$1
  shift
fi
if ! [[ $shards =~ ^[1-9][0-9]*$ ]]; then
  echo "$usage" >&2
  exit 2
fi
for arg in "$@"; do
  if [[ $arg != --filter=* ]]; then
    echo "$usage" >&2
    exit 2
  fi
done

cd "$(dirname "$0")/.."
zig build "build-test:$step"

dir=.zig-cache/test-shards/$step
rm -rf "$dir/run"
mkdir -p "$dir/run"
trap 'jobs -pr | xargs -r kill' EXIT
start=$(date +%s%N)
pids=()
for ((i = 0; i < shards; i++)); do
  "zig-out/bin/$step" --shard="$i/$shards" --durations="$dir/durations.tsv" --record="$dir/run/$i.tsv" "$@" \
    >"$dir/run/$i.log" 2>&1 &
  pids+=($!)
done
failed=()
for i in "${!pids[@]}"; do
  wait "${pids[$i]}" || failed+=("$i")
done
elapsed_ms=$((($(date +%s%N) - start) / 1000000))

# Without a terminal the runner prints "<i>/<n> <name>..." before each test and its result after
# any output the test wrote.
for i in "${failed[@]}"; do
  echo "shard $i failed: $dir/run/$i.log"
  awk '/^[0-9]+\/[0-9]+ / { name = $0; sub(/^[0-9]+\/[0-9]+ /, "", name); sub(/\.\.\..*/, "", name) }
    /FAIL \(/ { print "  FAIL " name }
    / panic: |\(err\): |leaked memory|errors were logged/ { print "  " $0 }' "$dir/run/$i.log" | head -20 || true
done

# Every shard prints "Running <selected> of <compiled> tests." before its first test.
read -r ran compiled < <(awk '/^Running [0-9]+ of [0-9]+ tests\.$/ { ran += $2; compiled = $4 } END { print ran + 0, compiled + 0 }' "$dir"/run/*.log)
if [[ ${#failed[@]} -gt 0 ]]; then
  status="${#failed[@]} shards failed"
elif [[ $# -eq 0 && $ran -ne $compiled ]]; then
  status="failed, the shards ran $ran of $compiled tests"
else
  status=passed
fi
printf 'test:%s %d shards, %d of %d tests, %d.%d s: %s\n' \
  "$step" "$shards" "$ran" "$compiled" $((elapsed_ms / 1000)) $((elapsed_ms % 1000 / 100)) "$status"

# A full passing run recorded every test, so it replaces the durations; other runs update theirs.
records=("$dir"/run/*.tsv)
if [[ $# -gt 0 || $status != passed ]] && [[ -f $dir/durations.tsv ]]; then
  records+=("$dir/durations.tsv")
fi
if [[ ${#records[@]} -gt 0 ]]; then
  awk -F '\t' '!seen[$2]++' "${records[@]}" >"$dir/durations.next"
  mv "$dir/durations.next" "$dir/durations.tsv"
fi

[[ $status == passed ]]
