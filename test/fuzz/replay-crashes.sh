#!/bin/bash
# Replay all AFL++ crash files against fuzz binaries.
#
# Usage:
#   ./replay-crashes.sh              # replay all targets
#   ./replay-crashes.sh ssz_lists    # replay one target

set -euo pipefail
shopt -s nullglob

FUZZ_DIR="$(cd "$(dirname "$0")" && pwd)"
BIN_DIR="${FUZZ_DIR}/zig-out/bin"
AFL_OUT="${FUZZ_DIR}/afl-out"

ssz_targets=(ssz_basic ssz_bitlist ssz_bitvector ssz_bytelist ssz_containers ssz_lists ssz_chunked_leaf_set ssz_wire_types)
bls_targets=(bls_public_key bls_signature bls_aggregate_pk bls_aggregate_sig)
discv5_targets=(discv5_wire)
source "${FUZZ_DIR}/network-targets.sh"
source "${FUZZ_DIR}/fuzz-env.sh"
targets=("${ssz_targets[@]}" "${bls_targets[@]}" "${discv5_targets[@]}" "${NETWORK_TARGETS[@]}")

if [ $# -ge 1 ]; then
    targets=("$1")
fi

total_crashes=0
total_replayed=0
total_failed=0

replay_target() {
    local target=$1
    local bin="${BIN_DIR}/fuzz-${target}"
    local crash_dirs=(
        "${AFL_OUT}/${target}"/*/crashes
        "${AFL_OUT}/${target}"/round-*/default/crashes
    )
    local found_crash_dir=0
    local found_crash=0
    local crash_dir
    local run_name
    local fname
    local f
    local crashes

    if [ ! -x "$bin" ]; then
        echo "SKIP ${target}: binary not found at ${bin}"
        return
    fi

    for crash_dir in "${crash_dirs[@]}"; do
        if [ ! -d "$crash_dir" ]; then
            continue
        fi

        found_crash_dir=1

        crashes=("$crash_dir"/id:*)
        if [ "${#crashes[@]}" -eq 0 ]; then
            continue
        fi

        found_crash=1

        run_name=$(basename "$(dirname "$crash_dir")")
        if [ "$(basename "$(dirname "$(dirname "$crash_dir")")")" != "$target" ]; then
            run_name="$(basename "$(dirname "$(dirname "$crash_dir")")")/${run_name}"
        fi

        for f in "${crashes[@]}"; do
            fname=$(basename "$f")
            total_crashes=$((total_crashes + 1))

            if fuzz_run_harness "$bin" < "$f" 2>/dev/null; then
                echo "PASS ${target} [${run_name}]: ${fname} (no longer crashes)"
                total_replayed=$((total_replayed + 1))
            else
                total_failed=$((total_failed + 1))
                echo "FAIL ${target} [${run_name}]: ${fname} (still crashes)"
                total_replayed=$((total_replayed + 1))
            fi
        done
    done

    if [ "$found_crash_dir" -eq 0 ]; then
        echo "OK   ${target}: no crashes directory"
        return
    fi

    if [ "$found_crash" -eq 0 ]; then
        echo "OK   ${target}: no crashes"
    fi
}

for target in "${targets[@]}"; do
    replay_target "$target"
done

echo ""
echo "Replayed ${total_replayed}/${total_crashes} crash files."

test "$total_failed" -eq 0
