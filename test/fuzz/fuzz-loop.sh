#!/bin/bash
# Runs afl-fuzz continuously: one main instance plus secondaries per target, all sharing
# afl-out/<target> so they exchange queue entries. A restart resumes every instance in
# place (AFL_AUTORESUME), so calibration and scheduling state is never thrown away.
# Corpus minimization is a separate, on-demand step (--cmin).
set -euo pipefail

FUZZ_DIR="$(cd "$(dirname "$0")" && pwd)"
BIN_DIR="${FUZZ_DIR}/zig-out/bin"
CORPUS_DIR="${FUZZ_DIR}/corpus"
AFL_OUT="${FUZZ_DIR}/afl-out"
LOGS_DIR="${FUZZ_DIR}/logs"

export AFL_AUTORESUME="${AFL_AUTORESUME:-1}"
source "${FUZZ_DIR}/network-targets.sh"
source "${FUZZ_DIR}/fuzz-env.sh"

SSZ_TARGETS=(ssz_basic ssz_bitlist ssz_bitvector ssz_bytelist ssz_containers ssz_lists ssz_chunked_leaf_set ssz_wire_types)
BLS_TARGETS=(bls_public_key bls_signature bls_aggregate_pk bls_aggregate_sig)
DISCV5_TARGETS=(discv5_wire)
ALL_TARGETS=("${SSZ_TARGETS[@]}" "${BLS_TARGETS[@]}" "${DISCV5_TARGETS[@]}" "${NETWORK_TARGETS[@]}")

# Secondaries rotate through these power schedules. MOpt (-L) stays off: AFL++ 4.09c spins
# printing "Fuzzing test case" without executing, and its log filled 317 GB in two hours.
SCHEDULES=(explore coe lin quad exploit rare)

usage() {
    echo "Usage: $0 [--status | --stop | --cmin] [target[=instances]...]"
    echo ""
    echo "Groups:  all, ssz, bls, discv5, network"
    echo "Targets: ${ALL_TARGETS[*]}"
    echo ""
    echo "Without an option, starts afl-fuzz for each target and waits: a main instance plus"
    echo "secondaries sharing afl-out/<target>. Restarting resumes the existing instances."
    echo ""
    echo "Options:"
    echo "  --status   print per-instance statistics for the selected targets"
    echo "  --stop     stop the running instances of the selected targets"
    echo "  --cmin     minimize the selected targets' queues into corpus/<target>-cmin"
    echo ""
    echo "Examples:"
    echo "  $0 network                                  # one instance per network target"
    echo "  $0 network_quic_session=3 network_wire=2    # per-target instance counts"
    echo "  INSTANCES=2 $0 ssz                          # default count for every target"
    echo "  TIMEOUT_MS=1000 $0 network_gossip_sessions  # fixed per-run timeout"
    echo "  $0 --status network                         # statistics without stopping"
    echo "  $0 --stop                                   # stop everything under afl-out"
    echo ""
    echo "Environment:"
    echo "  INSTANCES=1    instances per target without an explicit =count"
    echo "  TIMEOUT_MS=    afl-fuzz -t value; seeds exceeding it are skipped, not fatal"
    echo "  NO_FAKE_CLOCK=1      run without the preloaded process clock (snapshots then age)"
    echo "  FUZZ_CLOCK_STEP_NS=  nanoseconds the process clock advances per read (default 0)"
    exit 0
}

declare -A COUNTS
TARGETS=()

add_target() {
    local target=$1 count=$2
    for t in "${TARGETS[@]+"${TARGETS[@]}"}"; do
        if [ "$t" = "$target" ]; then
            COUNTS["$target"]=$count
            return
        fi
    done
    TARGETS+=("$target")
    COUNTS["$target"]=$count
}

resolve_targets() {
    local default_count="${INSTANCES:-1}"
    for arg in "$@"; do
        local name=$arg count=$default_count
        if [[ "$arg" == *=* ]]; then
            name=${arg%%=*}
            count=${arg#*=}
        fi
        if [[ ! "$count" =~ ^[1-9][0-9]*$ ]]; then
            echo "Error: instance count must be a positive integer: '${arg}'" >&2
            exit 1
        fi
        local members=()
        case "$name" in
            all)     members=("${ALL_TARGETS[@]}") ;;
            ssz)     members=("${SSZ_TARGETS[@]}") ;;
            bls)     members=("${BLS_TARGETS[@]}") ;;
            discv5)  members=("${DISCV5_TARGETS[@]}") ;;
            network) members=("${NETWORK_TARGETS[@]}") ;;
            *)
                local valid=false
                for t in "${ALL_TARGETS[@]}"; do
                    if [ "$name" = "$t" ]; then valid=true; break; fi
                done
                if ! $valid; then
                    echo "Error: unknown target '${name}'" >&2
                    echo "Valid targets: ${ALL_TARGETS[*]}" >&2
                    echo "Valid groups: all, ssz, bls, discv5, network" >&2
                    exit 1
                fi
                members=("$name")
                ;;
        esac
        for t in "${members[@]}"; do add_target "$t" "$count"; done
    done
}

seed_dir() {
    local target=$1
    local dir="${CORPUS_DIR}/${target}-cmin"
    if [ ! -d "$dir" ] || [ -z "$(ls -A "$dir" 2>/dev/null)" ]; then
        dir="${CORPUS_DIR}/${target}-${NETWORK_CORPUS[$target]:-initial}"
    fi
    echo "$dir"
}

stats_files() {
    local target=$1
    find "${AFL_OUT}/${target}" -mindepth 2 -maxdepth 3 -name fuzzer_stats 2>/dev/null | sort
}

stat_field() {
    awk -v key="$2" '$1 == key { print $3; exit }' "$1"
}

# A fuzzer_stats pid is live only when that pid is afl-fuzz running this instance's output directory.
instance_alive() {
    local pid output
    pid=$(stat_field "$1" fuzzer_pid)
    output=$(dirname "$(dirname "$1")")
    [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null || return 1
    [ "$(basename "$(readlink "/proc/$pid/exe" 2>/dev/null)")" = afl-fuzz ] || return 1
    tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | grep -qF -- "-o $output "
}

# afl-fuzz writes fuzzer_stats only after calibrating every seed, which can take minutes for
# a stateful harness, so each instance also records its pid at launch, with the process start
# time from /proc so a reused pid is not mistaken for the instance.
pid_files() {
    local target=$1
    find "${AFL_OUT}/${target}" -mindepth 1 -maxdepth 1 -name '*.pid' 2>/dev/null | sort
}

process_start() {
    awk '{ print $22 }' "/proc/$1/stat" 2>/dev/null
}

record_pid() {
    echo "$1 $(process_start "$1")" > "$2"
}

pid_alive() {
    local pid start
    read -r pid start < "$1" 2>/dev/null || return 1
    [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null || return 1
    [ "$(process_start "$pid")" = "$start" ] || return 1
    [ "$(basename "$(readlink "/proc/$pid/exe" 2>/dev/null)")" = afl-fuzz ]
}

pid_of() {
    cut -d' ' -f1 "$1" 2>/dev/null
}

start_target() {
    local target=$1 count=$2
    local bin="${BIN_DIR}/fuzz-${target}"
    if [ ! -x "$bin" ]; then
        echo "Error: ${bin} is missing; build it first" >&2
        exit 1
    fi
    local seeds output
    seeds=$(seed_dir "$target")
    output="${AFL_OUT}/${target}"
    mkdir -p "$output"

    local extra_args=()
    if [[ -n "${NETWORK_INPUT_MAX[$target]:-}" ]]; then extra_args+=(-G "${NETWORK_INPUT_MAX[$target]}"); fi
    local dictionary="${FUZZ_DIR}/dictionaries/${target}.dict"
    if [ -f "$dictionary" ]; then extra_args+=(-x "$dictionary"); fi
    # AFL++ 4.09c stores the slowest seed's exec_us as the -t ...+ timeout in ms, a thousandfold too long.
    if [ -n "${TIMEOUT_MS:-}" ]; then extra_args+=(-t "${TIMEOUT_MS}"); fi

    local i
    for ((i = 0; i < count; i++)); do
        local name role=() tuning=()
        if [ "$i" -eq 0 ]; then
            name=main
            role=(-M main)
        else
            name="s${i}"
            role=(-S "$name")
            tuning=(-p "${SCHEDULES[$(((i - 1) % ${#SCHEDULES[@]}))]}")
        fi
        if [ -f "${output}/${name}.pid" ] && pid_alive "${output}/${name}.pid"; then
            echo "  fuzz-${target} ${name} already running (pid $(pid_of "${output}/${name}.pid"))"
            continue
        fi
        afl-fuzz "${role[@]}" "${tuning[@]}" "${extra_args[@]}" \
            -i "$seeds" \
            -o "$output" \
            -- "$bin" \
            >> "${LOGS_DIR}/${target}.${name}.log" 2>&1 &
        PIDS+=($!)
        record_pid "$!" "${output}/${name}.pid"
        echo "  fuzz-${target} ${name} started (pid $!, seeds $(basename "$seeds"))"
    done
}

run() {
    PIDS=()
    mkdir -p "$LOGS_DIR"
    if [ -z "$FUZZ_CLOCK_LIB" ]; then
        for target in "${TARGETS[@]}"; do
            if fuzz_needs_clock "$target"; then
                if [ -n "${NO_FAKE_CLOCK:-}" ]; then
                    echo "Warning: ${target} runs in snapshot mode without the process clock; its connected snapshot ages between forks." >&2
                else
                    echo "Error: ${target} runs in snapshot mode and needs zig-out/lib/libfuzz_clock.so; build it with 'zig build -Doptimize=ReleaseSafe build-network' (NO_FAKE_CLOCK=1 overrides)" >&2
                    exit 1
                fi
            fi
        done
    fi
    echo "Starting $(date): ${#TARGETS[@]} target(s)${AFL_PRELOAD:+, process clock ${AFL_PRELOAD} (step ${FUZZ_CLOCK_STEP_NS} ns)}"
    for target in "${TARGETS[@]}"; do
        start_target "$target" "${COUNTS[$target]}"
    done
    if [ "${#PIDS[@]}" -eq 0 ]; then
        echo "Nothing started."
        return
    fi
    # afl-fuzz runs until stopped; an early exit means a setup problem, so report it.
    for pid in "${PIDS[@]}"; do
        if ! wait "$pid"; then
            echo "Instance pid ${pid} exited with an error at $(date); see logs/"
        fi
    done
    echo "All instances exited at $(date)"
}

status() {
    local total_crashes=0 total_hangs=0 now
    now=$(date +%s)
    printf '%-28s %-5s %-5s %10s %8s %6s %7s %8s %7s %6s %12s\n' target inst state execs exec/s paths favs stabil crash hang last_find
    for target in "${TARGETS[@]}"; do
        for pidfile in $(pid_files "$target"); do
            local inst
            inst=$(basename "$pidfile" .pid)
            if pid_alive "$pidfile" && [ ! -f "${AFL_OUT}/${target}/${inst}/fuzzer_stats" ]; then
                printf '%-28s %-5s %-5s %10s\n' "$target" "$inst" start calibrating
            fi
        done
        for stats in $(stats_files "$target"); do
            local inst state last
            inst=$(basename "$(dirname "$stats")")
            # A relaunched instance keeps its predecessor's stats until it finishes calibrating.
            if instance_alive "$stats"; then
                state=live
            elif [ -f "${AFL_OUT}/${target}/${inst}.pid" ] && pid_alive "${AFL_OUT}/${target}/${inst}.pid"; then
                state=start
            else
                state=dead
            fi
            last=$(stat_field "$stats" last_find)
            if [ -n "$last" ] && [ "$last" -gt 0 ]; then last="$(( (now - last) / 60 ))m ago"; else last=never; fi
            local crashes hangs
            crashes=$(stat_field "$stats" saved_crashes)
            hangs=$(stat_field "$stats" saved_hangs)
            total_crashes=$((total_crashes + ${crashes:-0}))
            total_hangs=$((total_hangs + ${hangs:-0}))
            printf '%-28s %-5s %-5s %10s %8s %6s %7s %8s %7s %6s %12s\n' "$target" "$inst" "$state" \
                "$(stat_field "$stats" execs_done)" "$(stat_field "$stats" execs_ps_last_min)" \
                "$(stat_field "$stats" corpus_count)" "$(stat_field "$stats" pending_favs)" \
                "$(stat_field "$stats" stability)" "$crashes" "$hangs" "$last"
        done
    done
    echo "total crashes=${total_crashes} hangs=${total_hangs}"
    if [ "$total_crashes" -gt 0 ] || [ "$total_hangs" -gt 0 ]; then
        echo "Inspect them with ./replay-crashes.sh <target>."
    fi
}

stop() {
    local pids=()
    for target in "${TARGETS[@]}"; do
        for pidfile in $(pid_files "$target"); do
            if pid_alive "$pidfile"; then
                local pid
                pid=$(pid_of "$pidfile")
                kill "$pid" && pids+=("$pid") && echo "  stopping ${target} $(basename "$pidfile" .pid) (pid ${pid})"
            fi
        done
        for stats in $(stats_files "$target"); do
            if instance_alive "$stats"; then
                local pid
                pid=$(stat_field "$stats" fuzzer_pid)
                if [[ " ${pids[*]+"${pids[*]}"} " != *" ${pid} "* ]]; then
                    kill "$pid" && pids+=("$pid") && echo "  stopping ${target} $(basename "$(dirname "$stats")") (pid ${pid})"
                fi
            fi
        done
    done
    local waited=0
    while [ "${#pids[@]}" -gt 0 ] && [ "$waited" -lt 30 ]; do
        local remaining=()
        for pid in "${pids[@]}"; do
            if kill -0 "$pid" 2>/dev/null; then remaining+=("$pid"); fi
        done
        pids=("${remaining[@]+"${remaining[@]}"}")
        sleep 1
        waited=$((waited + 1))
    done
    if [ "${#pids[@]}" -gt 0 ]; then
        echo "Still running after 30 s: ${pids[*]}" >&2
        exit 1
    fi
    echo "Stopped."
}

cmin() {
    for target in "${TARGETS[@]}"; do
        local bin="${BIN_DIR}/fuzz-${target}"
        local merged="${CORPUS_DIR}/${target}-cmin-queues"
        local cmin_tmp="${CORPUS_DIR}/${target}-cmin-tmp"
        local cmin_final="${CORPUS_DIR}/${target}-cmin"
        rm -rf "$merged" "$cmin_tmp"
        mkdir -p "$merged"
        local queues=0
        local queue
        for queue in "${AFL_OUT}/${target}"/*/queue; do
            [ -d "$queue" ] || continue
            local inst
            inst=$(basename "$(dirname "$queue")")
            local f
            for f in "$queue"/id:*; do
                [ -f "$f" ] || continue
                cp "$f" "${merged}/${inst}-$(basename "$f")"
                queues=$((queues + 1))
            done
        done
        if [ "$queues" -eq 0 ]; then
            echo "  ${target}: no queue entries, skipping"
            rm -rf "$merged"
            continue
        fi
        afl-cmin -i "$merged" -o "$cmin_tmp" -T all -- "$bin" > "${LOGS_DIR}/${target}.cmin.log" 2>&1
        rm -rf "$merged"
        # A committed corpus is a reviewed seed set, not campaign output.
        if git -C "$FUZZ_DIR" ls-files --error-unmatch "corpus/${target}-cmin" > /dev/null 2>&1; then
            cmin_final="${CORPUS_DIR}/${target}-cmin-new"
        fi
        rm -rf "$cmin_final"
        mv "$cmin_tmp" "$cmin_final"
        echo "  ${target}: ${queues} queue entries -> $(ls "$cmin_final" | wc -l) files in $(basename "$cmin_final")"
    done
}

MODE=run
case "${1:-}" in
    -h|--help) usage ;;
    --status) MODE=status; shift ;;
    --stop) MODE=stop; shift ;;
    --cmin) MODE=cmin; shift ;;
esac

if [ $# -eq 0 ]; then
    resolve_targets all
else
    resolve_targets "$@"
fi

mkdir -p "$LOGS_DIR"
case "$MODE" in
    run) run ;;
    status) status ;;
    stop) stop ;;
    cmin) cmin ;;
esac
