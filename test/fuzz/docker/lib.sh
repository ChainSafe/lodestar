# Shared by run-fuzz.sh and minimize.sh: the platform's environment, the
# target's paths, and the steps both need. Sourced, never run.
#
# State layout, all inside $FUZZ_STATE so it survives restarts:
#   corpus/  the minimized corpus; replaced only by minimize.sh, by rename
#   afl/     AFL++'s working dir (queue, stats, plot_data); minimize.sh
#            discards it, so the next start fuzzes from corpus/

: "${FUZZ_TARGET:?FUZZ_TARGET is required, e.g. ssz-basic -- see /opt/fuzz/bin}"
FUZZ_PROJECT="${FUZZ_PROJECT:-lodestar-z}"
FUZZ_STATE="${FUZZ_STATE:-/fuzz/state}"
FUZZ_FAILURES="${FUZZ_FAILURES:-/fuzz/failures}"
FUZZ_METRICS="${FUZZ_METRICS:-/fuzz/metrics}"
TMPDIR="${TMPDIR:-/tmp}"

# The fuzz platform's target names allow hyphens but not underscores, so
# `ssz-basic` and `ssz_basic` both select the ssz_basic harness and corpus.
HARNESS=$(printf '%s' "$FUZZ_TARGET" | tr '-' '_')
BIN="/opt/fuzz/bin/fuzz-$HARNESS"
OUT="$FUZZ_STATE/afl"
CORPUS="$FUZZ_STATE/corpus"

if [ ! -x "$BIN" ]; then
    echo "FATAL unknown FUZZ_TARGET '$FUZZ_TARGET'; available:" $(ls /opt/fuzz/bin | sed 's/^fuzz-//; s/_/-/g')
    exit 2
fi

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

# minimize.sh swaps corpus/ in two renames; if it was killed between them,
# put the previous corpus back.
restore_corpus() {
    if [ ! -d "$CORPUS" ] && [ -d "$CORPUS.old" ]; then
        mv "$CORPUS.old" "$CORPUS"
        echo "WARN restored the previous corpus after an interrupted minimize"
    fi
}
