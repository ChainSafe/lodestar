#!/bin/sh
# Minimizes one target's corpus: this project's side of the ChainSafe fuzz
# platform's minimize contract. The image names this script in its
# org.chainsafe.fuzz.minimize label, and the platform runs it on a schedule
# while the campaign is stopped, with the campaign's environment and volume.
#
#   - input: the campaign's queue, the previous minimized corpus and the
#     committed seeds, so coverage never drops below what the repo has
#   - afl-cmin keeps the smallest set with the same edge coverage, in
#     $FUZZ_STATE/corpus; the next start fuzzes from it
#   - AFL++'s working dir is then discarded, which also drops plot_data and
#     the stats that otherwise grow for as long as a campaign runs
#   - exit 0 when done or when there is nothing to minimize; non-zero leaves
#     the state as it was. Safe to kill at any point.
set -u

. /opt/fuzz/lib.sh

restore_corpus

if ! ls "$OUT"/default/queue/id:* >/dev/null 2>&1; then
    echo "MINIMIZE target=$FUZZ_TARGET nothing to minimize"
    exit 0
fi

# Discarding $OUT below would lose any crash not yet copied out, e.g. after
# the campaign was killed rather than stopped.
sync_findings CRASH crashes crash
sync_findings HANG hangs hang

# Next to the state, not in $TMPDIR: the same filesystem, so the result moves
# into place by rename, and no tmpfs sized for the corpus.
WORK="$FUZZ_STATE/.minimize"
rm -rf "$WORK"
mkdir -p "$WORK/in"

# Content-hashed names: identical inputs collapse into one, AFL++'s id:
# names cannot collide across sources, and names stay stable between runs.
for f in "$OUT"/default/queue/id:* "$CORPUS"/* \
         "/opt/fuzz/corpus/$HARNESS-cmin"/* "/opt/fuzz/corpus/$HARNESS-initial"/*; do
    [ -f "$f" ] || continue
    cp "$f" "$WORK/in/$(sha256sum "$f" | cut -c1-16)"
done
before=$(ls "$WORK/in" | wc -l)

# -m none: the container's memory limit applies. -t: a slow input is dropped
# rather than stalling the run. Crashing inputs are skipped by afl-cmin.
if ! afl-cmin -m none -t "${FUZZ_MINIMIZE_INPUT_TIMEOUT_MS:-5000}" \
        -i "$WORK/in" -o "$WORK/out" -- "$BIN" >"$WORK/cmin.log" 2>&1; then
    echo "FATAL afl-cmin failed; the corpus is unchanged. Last log lines:"
    tail -20 "$WORK/cmin.log"
    rm -rf "$WORK"
    exit 1
fi
after=$(ls "$WORK/out" | wc -l)
if [ "$after" -eq 0 ]; then
    echo "FATAL afl-cmin kept no inputs; the corpus is unchanged"
    rm -rf "$WORK"
    exit 1
fi

# Swap, then drop the working dir. If killed between the two renames,
# restore_corpus puts the previous corpus back.
rm -rf "$CORPUS.old"
if [ -d "$CORPUS" ]; then mv "$CORPUS" "$CORPUS.old"; fi
mv "$WORK/out" "$CORPUS"
rm -rf "$CORPUS.old" "$OUT" "$WORK"

echo "MINIMIZE target=$FUZZ_TARGET inputs=$before kept=$after"
