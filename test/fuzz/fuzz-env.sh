#!/bin/bash
# Shared AFL, clock and entropy policy for every script that runs a harness. Source it; it never fails.
#
# Snapshot-mode harnesses fork every input from a connected QUIC pair, and quiche keeps its
# timers on the libc clock. The build installs zig-out/lib/libfuzz_clock.so (pkg/afl++/
# fuzz_clock.c), a process-local clock that starts at a fixed instant and moves only when the
# harness advances its own logical clock, or by FUZZ_CLOCK_STEP_NS per read. A fork child
# inherits the parent's value by copy, so every input starts at the same time and advances
# independently. The library also pins getrandom, getentropy and the raw syscall, since BoringSSL
# reseeds after a fork. NO_FAKE_CLOCK=1 disables it; FUZZ_CLOCK_LIB points at another build.
FUZZ_ENV_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export AFL_CRASH_EXITCODE=99
export AFL_SKIP_CPUFREQ="${AFL_SKIP_CPUFREQ:-1}"
export AFL_NO_UI="${AFL_NO_UI:-1}"
export AFL_NO_AFFINITY="${AFL_NO_AFFINITY:-1}"
export AFL_I_DONT_CARE_ABOUT_MISSING_CRASHES="${AFL_I_DONT_CARE_ABOUT_MISSING_CRASHES:-1}"

if [ -n "${NO_FAKE_CLOCK:-}" ]; then
    FUZZ_CLOCK_LIB=""
else
    FUZZ_CLOCK_LIB="${FUZZ_CLOCK_LIB:-}"
    if [ -z "$FUZZ_CLOCK_LIB" ] && [ -f "${FUZZ_ENV_DIR}/zig-out/lib/libfuzz_clock.so" ]; then
        FUZZ_CLOCK_LIB="${FUZZ_ENV_DIR}/zig-out/lib/libfuzz_clock.so"
    fi
fi
if [ -n "$FUZZ_CLOCK_LIB" ]; then
    export AFL_PRELOAD="$FUZZ_CLOCK_LIB"
    export FUZZ_CLOCK_STEP_NS="${FUZZ_CLOCK_STEP_NS:-0}"
fi

# Runs a harness binary outside afl-fuzz with the same clock policy, input on stdin.
fuzz_run_harness() {
    if [ -n "$FUZZ_CLOCK_LIB" ]; then
        LD_PRELOAD="$FUZZ_CLOCK_LIB" __AFL_DEFER_FORKSRV=1 "$@"
    else
        __AFL_DEFER_FORKSRV=1 "$@"
    fi
}

# True when the target runs in snapshot mode and therefore needs the clock policy.
fuzz_needs_clock() {
    [ "${NETWORK_MODE[$1]:-persistent}" = snapshot ]
}
