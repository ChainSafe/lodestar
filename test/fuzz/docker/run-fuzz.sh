#!/bin/sh
# Entrypoint of the lodestar-z fuzzing image (Dockerfile.fuzz).
#
# Runs one AFL++ campaign for $FUZZ_TARGET and fulfils this project's side of
# the ChainSafe fuzz platform's container contract:
#   - all AFL++ state lives in $FUZZ_STATE, so any restart resumes the campaign
#   - every new crash or hang is copied, deduplicated by content hash, into
#     $FUZZ_FAILURES and announced with a NEW_CRASH / NEW_HANG line
#   - $FUZZ_METRICS/status carries the platform's engine-neutral numbers and is
#     rewritten every interval -- its age is how the platform spots a hang
#   - a STATS line goes to stdout every interval
#   - SIGTERM is forwarded, so afl-fuzz saves its state before exiting
#   - if afl-fuzz itself dies, this exits non-zero: an infrastructure failure
#
# The same defaults apply outside the platform, so a plain `docker run` with a
# volume on /fuzz works for local runs (see test/fuzz/README.md).
set -u

: "${FUZZ_TARGET:?FUZZ_TARGET is required, e.g. ssz-basic -- see /opt/fuzz/bin}"
FUZZ_PROJECT="${FUZZ_PROJECT:-lodestar-z}"
FUZZ_STATE="${FUZZ_STATE:-/fuzz/state}"
FUZZ_FAILURES="${FUZZ_FAILURES:-/fuzz/failures}"
FUZZ_METRICS="${FUZZ_METRICS:-/fuzz/metrics}"
TMPDIR="${TMPDIR:-/tmp}"
# afl-fuzz rewrites fuzzer_stats once a minute; reporting faster repeats stale numbers.
STATS_INTERVAL="${STATS_INTERVAL:-60}"

# The fuzz platform's target names allow hyphens but not underscores, so
# `ssz-basic` and `ssz_basic` both select the ssz_basic harness and corpus.
HARNESS=$(printf '%s' "$FUZZ_TARGET" | tr '-' '_')
BIN="/opt/fuzz/bin/fuzz-$HARNESS"
OUT="$FUZZ_STATE/afl"

if [ ! -x "$BIN" ]; then
    echo "FATAL unknown FUZZ_TARGET '$FUZZ_TARGET'; available:" $(ls /opt/fuzz/bin | sed 's/^fuzz-//; s/_/-/g')
    exit 2
fi
mkdir -p "$FUZZ_STATE" "$FUZZ_FAILURES" "$FUZZ_METRICS" "$TMPDIR"

# Seeds, best first: the minimised corpus, the hand-made one, else one byte.
# Only used to start a campaign; a restart resumes from $OUT (AFL_AUTORESUME).
SEEDS=""
for d in "/opt/fuzz/corpus/$HARNESS-cmin" "/opt/fuzz/corpus/$HARNESS-initial"; do
    if [ -d "$d" ] && [ -n "$(ls -A "$d")" ]; then SEEDS="$d"; break; fi
done
if [ -z "$SEEDS" ]; then
    SEEDS="$TMPDIR/seeds"
    mkdir -p "$SEEDS" && printf '\000' > "$SEEDS/zero"
    echo "WARN no seed corpus for $FUZZ_TARGET; starting from a single zero byte"
fi

export AFL_NO_UI=1            # plain log output, not the curses screen
export AFL_SKIP_CPUFREQ=1     # a container cannot see or set the CPU governor
export AFL_NO_AFFINITY=1      # the scheduler's cpuset already pins the task
export AFL_AUTORESUME=1       # resume from $OUT after any restart

sync_findings() {  # kind, afl dir, prefix
    for f in "$OUT/default/$2"/id:*; do
        [ -e "$f" ] || continue
        h=$(sha256sum "$f" | cut -c1-16)
        if [ ! -e "$FUZZ_FAILURES/$3-$h" ]; then
            cp "$f" "$FUZZ_FAILURES/$3-$h"
            echo "NEW_$1 file=$3-$h afl_id=$(basename "$f")"
        fi
    done
}

# Map fuzzer_stats onto the platform's status fields. Written to a temporary
# file and renamed, so the platform never reads half a file.
write_status() {
    s="$OUT/default/fuzzer_stats"
    # The status file's age is the platform's liveness signal, so refresh it
    # every interval even before afl-fuzz has written stats -- resuming a large
    # corpus can take minutes, and silence then would read as a hung campaign.
    # The previous numbers are kept until new ones exist.
    if [ ! -f "$s" ]; then
        touch "$FUZZ_METRICS/status"
        return 0
    fi
    awk -F' *: *' '
        $1 == "execs_done"    { print "execs_total", $2 }
        $1 == "execs_per_sec" { print "execs_per_second", $2 }
        $1 == "corpus_count"  { print "corpus_entries", $2 }
        $1 == "edges_found"   { print "coverage", $2 }
        $1 == "saved_crashes" { print "crashes_total", $2 }
        $1 == "saved_hangs"   { print "hangs_total", $2 }
        $1 == "last_find" && $2 > 0 { print "last_find_timestamp_seconds", $2 }
    ' "$s" > "$FUZZ_METRICS/status.tmp" && mv -f "$FUZZ_METRICS/status.tmp" "$FUZZ_METRICS/status"
}

report() {
    s="$OUT/default/fuzzer_stats"
    [ -f "$s" ] || { echo "STATS starting"; return; }
    awk -F' *: *' '
        $1 ~ /^(run_time|execs_done|execs_per_sec|corpus_count|edges_found|saved_crashes|saved_hangs)$/ {
            printf "%s=%s ", $1, $2 }
        END { print "" }' "$s" | sed 's/^/STATS /'
}

echo "START project=$FUZZ_PROJECT target=$FUZZ_TARGET seeds=$SEEDS state=$OUT"
# The harness reads stdin, so no @@ (see test/fuzz/README.md).
afl-fuzz -i "$SEEDS" -o "$OUT" -- "$BIN" >"$TMPDIR/afl.log" 2>&1 &
pid=$!
# Report at once rather than after the first interval, so a new or restarted
# campaign is never shown as `missing` while it starts.
write_status

trap 'echo "SIGTERM: stopping afl-fuzz"; kill -TERM "$pid"; wait "$pid"; sync_findings CRASH crashes crash; sync_findings HANG hangs hang; write_status; exit 0' TERM INT

while kill -0 "$pid" 2>/dev/null; do
    sleep "$STATS_INTERVAL" & wait $!
    sync_findings CRASH crashes crash
    sync_findings HANG hangs hang
    write_status
    report
done

wait "$pid"; rc=$?
sync_findings CRASH crashes crash
sync_findings HANG hangs hang
echo "FATAL afl-fuzz exited rc=$rc; last log lines:"
tail -20 "$TMPDIR/afl.log"
exit "${rc:-1}"
