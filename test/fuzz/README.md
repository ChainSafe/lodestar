# AFL++ Fuzzer for lodestar-z

This directory contains [AFL++](https://aflplus.plus/) fuzzing harnesses
for SSZ deserialization in lodestar-z.

## Fuzz Targets

### SSZ

| Target                 | Binary                      | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ssz_basic`            | `fuzz-ssz_basic`            | Bool, Uint8/16/32/64/128/256                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `ssz_bitlist`          | `fuzz-ssz_bitlist`          | BitList(8/64/2048)                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `ssz_bitvector`        | `fuzz-ssz_bitvector`        | BitVector(4/32/64/512)                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `ssz_bytelist`         | `fuzz-ssz_bytelist`         | ByteList(32/256/1024)                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `ssz_containers`       | `fuzz-ssz_containers`       | Fork, Checkpoint, Eth1Data, Attestation, etc.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `ssz_lists`            | `fuzz-ssz_lists`            | FixedList(Uint64/32/Bool), VariableList(ByteList)                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `ssz_chunked_leaf_set` | `fuzz-ssz_chunked_leaf_set` | FixedList(Uint64, chunked_leaf=true): replay set/commit/get op stream, assert root equivalence against fromValue(reference)                                                                                                                                                                                                                                                                                                                                          |
| `ssz_wire_types`       | `fuzz-ssz_wire_types`       | Every consensus type that arrives over gossip or reqresp, phase0 through gloas (blocks, blinded blocks, blob and data column sidecars, attestations, aggregates, slashings, exits, sync messages, light client updates, payload envelopes and bids): the value decoder, the serialized validator and the tree decoder must agree on acceptance, re-encoded bytes and hash tree root, through a leak-checking allocator. Selector table in `tools/ssz_wire_types.zig` |

Each SSZ input is `[selector_byte][ssz_data...]`. The first byte selects
which SSZ type to test within the target. See source files for the mapping.
`zig build extract-corpus` writes the `-initial` seed directories from the
downloaded spec vectors (`zig build run:download_spec_tests` at the repository
root); `ssz_wire_types` gets one default-value seed per selector plus every
mainnet `ssz_static` vector up to 1 MiB.

### Network (stateful)

Single-shot decoders cover the wire formats; these harnesses drive the state machines. Each
input is an opcode stream: one byte selects the operation and the following bytes supply
its parameters, so AFL mutations become session histories. Every step ends with the owner's
own invariant checks (`checkInvariants`, `checkScheduling`, the reqresp route invariant) and
the harness's whole-table accounting.

| Target                        | Drives                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Invariants                                                                                                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `network_gossip_sessions`     | One `Gossipsub` without a transport: SUBSCRIBE, GRAFT, PRUNE, IHAVE, IWANT, IDONTWANT and messages from several sessions, clock advances, heartbeats, verdicts, outbox drains, disconnects and reconnects                                                                                                                                                                                                                                                                                                                             | store pages and entries, validation pins, promise balance, delivery pool reserves, finite scores, ready-list scheduling                                                    |
| `network_gossip_recovery`     | IHAVE floods, announced-then-delivered ids, IWANT, promise expiry and cancellation, reconnects with the same identity, penalties and decay                                                                                                                                                                                                                                                                                                                                                                                            | as above, with promise reserves exercised at capacity                                                                                                                      |
| `network_processor_admission` | `Gossipsub` feeding a `GossipProcessor`: mixed kinds, sources and sizes, newest-first eviction, dependency checks and waits, claim, finish, report, verdict pumping, expiry, slot changes, `dropQueued` and `dropPeer`                                                                                                                                                                                                                                                                                                                | per-kind items and bytes, per-source charges, state counts, execution credits, store entries, empty table at close                                                         |
| `network_reqresp_session`     | Two `ReqResp` instances per side over an in-process QUIC pair: requests, responses, error responses, finish, cancel, serving retain and release, raw request and response bytes with arbitrary splits and FIN placement, stream resets, clock advances for every timeout                                                                                                                                                                                                                                                              | route invariant, slot and event accounting, no pending request after `cancelAll`                                                                                           |
| `network_quic_session`        | Two engines through a real handshake, then stream opens, writes, reads, capacity polls, shutdowns, closes, route binds, hostile datagrams on the established path, time jumps, connection close, one further dial per input with its handshake under the same operations (more attempts hit the dialing and connection limits), streams on it, abandon and close, stop admission, close all, a datagram-loss policy toward either address, and the host's read-only queries                                                           | engine invariants after every step, route and connection counts, clean teardown                                                                                            |
| `network_discv5_session`      | A discv5 `Engine` with three real peers over an in-process link: PING, FINDNODE and TALKREQ in both directions, standard responses, TALKRESP and NODES answers with chosen record counts, delivery in order, reordered, duplicated, corrupted, truncated, dropped or replayed from spoofed addresses and to the wrong engine, random datagrams, floods from many sources, time advances to the next deadline, call cancel and fail, routing confirmations, unresponsive marks, local record updates, and the host's read-only queries | calls held equal the call table, sessions and challenges within capacity, routing table within capacity, every held call cancellable and the call tables empty at teardown |

These harnesses link both snappy and quiche where needed (`all` in `network-targets.tsv`)
and run in snapshot mode (`snapshot` in the same table): `zig_fuzz_init` builds the
protocol state once, including the QUIC handshake, and the fork server starts after it.
Every input runs in a fresh fork of that state and checks cleanup on its own copy.
The gossip fixture closes peers and checks pooled resources without freeing its large
allocations: the kernel reclaims them when the child exits, avoiding the copy-on-write
cost of filling freed memory with undefined bytes. The processor, QUIC and reqresp
instances still run their deinitializers. Nothing is rebuilt per input and every input
sees the identical starting state.

quiche keeps its timers on the libc clock, so every harness run preloads
`zig-out/lib/libfuzz_clock.so` (`pkg/afl++/fuzz_clock.c`, built with the harnesses): a
process-local clock that starts at a fixed instant and moves only when the harness advances
its own logical clock (the QUIC and reqresp harnesses call `fuzz_clock_advance` from their
time-advance operations), or by `FUZZ_CLOCK_STEP_NS` per read. A fork child inherits the
parent's value by copy, so every input starts at the same time and advances independently,
while loss recovery and idle timers still expire as the input advances time. The same
library pins entropy (`getrandom`, `getentropy` and the raw syscall) to a generator in
process memory: BoringSSL reseeds itself after it detects a fork, so without this every
child's handshake drew different TLS randoms and the map varied run to run. `fuzz-env.sh`
holds this policy and the AFL environment; `fuzz-loop.sh`, `replay-crashes.sh`,
`smoke-network.sh` and the build's `run-<target>` steps all apply it, and `fuzz-loop.sh`
refuses to start a snapshot target without the library (`NO_FAKE_CLOCK=1` overrides, with
aging snapshots). Replay an input by hand with the same policy:

```sh
source fuzz-env.sh
fuzz_run_harness zig-out/bin/fuzz-network_quic_session < input
```

Use ReleaseSafe for campaigns; gossip uses an input-driven clock.

A harness panic prints the assertion's return address as an offset into the binary, plus
the failing step for the QUIC session harness; `addr2line -e zig-out/bin/fuzz-<target>
<offset>` names the source line.

```sh
zig build -Doptimize=ReleaseSafe build-network
zig build -Doptimize=ReleaseSafe test-harnesses
./smoke-network.sh network_gossip_sessions network_processor_admission
```

The build instruments quiche with LLVM sanitizer coverage (`RUSTFLAGS` set on
quiche-zig's cargo step, so it is part of the step's cache key): its guards land
in the section the AFL shim registers for the Zig code, so AFL sees edges inside
quiche as well as in the engine. The quic_session harness went from a plateau of
about 800 edges to over 5,000 within a minute of the first instrumented run.
`-Dquiche_sancov=false` builds the plain library.

### BLS

| Target              | Binary                   | Description                                                  |
| ------------------- | ------------------------ | ------------------------------------------------------------ |
| `bls_public_key`    | `fuzz-bls_public_key`    | Deserialize → validate → serialize roundtrip for `PublicKey` |
| `bls_signature`     | `fuzz-bls_signature`     | Deserialize → validate → serialize roundtrip for `Signature` |
| `bls_aggregate_pk`  | `fuzz-bls_aggregate_pk`  | Aggregate multiple `PublicKey`s, with and without randomness |
| `bls_aggregate_sig` | `fuzz-bls_aggregate_sig` | Aggregate multiple `Signature`s, with and without randomness |

BLS inputs are raw bytes interpreted directly as compressed point encodings.

## Prerequisites

Install AFL++ so that `afl-cc` and `afl-fuzz` are on your `PATH`.

- **macOS (Homebrew):** `brew install afl++`
- **Linux:** build from source or use your distro's package (e.g.
  `apt install afl++` on Debian/Ubuntu).

## Building

From this directory (`test/fuzz`):

```sh
zig build
```

This compiles Zig static libraries for each fuzz target, emits LLVM bitcode,
then links each with `afl.c` using `afl-cc` to produce instrumented binaries
at `zig-out/bin/fuzz-*`.

## Running the Fuzzer

Each target has its own run step:

```sh
zig build run-ssz_basic
zig build run-ssz_containers
```

Or invoke `afl-fuzz` directly:

```sh
AFL_CRASH_EXITCODE=99 afl-fuzz -i corpus/ssz_basic-cmin -o afl-out/ssz_basic \
  -- zig-out/bin/fuzz-ssz_basic
```

Harness panics exit with code 99. The launch scripts and build steps configure
`AFL_CRASH_EXITCODE` so AFL records these as crashes.

The fuzzer runs indefinitely. Let it run for as long as you like; meaningful
coverage is usually reached within a few hours, but longer runs can find
deeper bugs. Press `ctrl+c` to stop the fuzzer when you're done.

On Linux containers, AFL++ may abort if `/proc/sys/kernel/core_pattern` is
configured to pipe core dumps. If you cannot change sysctl as root, run with:

```sh
AFL_I_DONT_CARE_ABOUT_MISSING_CRASHES=1 zig build run-ssz_basic
```

BLS targets work the same way:

```sh
zig build run-bls_public_key
zig build run-bls_signature
zig build run-bls_aggregate_pk
zig build run-bls_aggregate_sig
```

### Running targets in a loop

`fuzz-loop.sh` starts afl-fuzz for each target and keeps it running: a main
instance plus any number of secondaries share `afl-out/<target>`, exchange
queue entries, and run different power schedules. Instances are never restarted on a timer, so AFL's calibration and
scheduling state is kept; a restart resumes each instance in place through
`AFL_AUTORESUME`.

```sh
./fuzz-loop.sh --help
Usage: ./fuzz-loop.sh [--status | --stop | --cmin] [target[=instances]...]

Examples:
  ./fuzz-loop.sh network                                  # one instance per network target
  ./fuzz-loop.sh network_quic_session=3 network_wire=2    # per-target instance counts
  INSTANCES=2 ./fuzz-loop.sh ssz                          # default count for every target
  TIMEOUT_MS=1000 ./fuzz-loop.sh network_gossip_sessions  # fixed per-run timeout
  ./fuzz-loop.sh --status network                         # statistics without stopping
  ./fuzz-loop.sh --stop                                   # stop everything under afl-out
```

`TIMEOUT_MS` passes `-t <ms>` so a seed that exceeds it is skipped rather
than fatal; the stateful harnesses run at tens of executions per second, where
AFL's auto-scaled timeout files load spikes as hangs. The loop never adds AFL's
`+` suffix: AFL++ 4.09c stores the slowest seed's exec time in microseconds as
the millisecond timeout, a thousandfold too long.

Each instance records its pid with the process start time from `/proc`, so
`--stop` and the already-running check never act on a reused pid. `--cmin`
writes to `corpus/<target>-cmin-new` when `corpus/<target>-cmin` is tracked by
git, since a committed corpus is a reviewed seed set rather than campaign
output.

Logs are written to `logs/<target>.<instance>.log`. `--status` prints
executions, paths, pending favorites, stability, crashes and hangs per
instance; run `./replay-crashes.sh` to inspect crashes. `--cmin` merges every
instance queue of a target and minimizes it into `corpus/<target>-cmin`; use it
before a restart that needs fresh seeds, such as after a harness change, not on
a schedule.

To keep a campaign running after the shell exits, start the loop detached, for
example `TIMEOUT_MS=1000 setsid nohup ./fuzz-loop.sh network_quic_session=2 >>
logs/loop.log 2>&1 < /dev/null &`; `--status` and `--stop` work from any shell.

## Finding Crashes and Hangs

After (or during) a run, results are written to `afl-out/<target>/<instance>/`,
where `<instance>` is `main` or `s1`, `s2`, ... (`default` for a run started
by hand without `-M`/`-S`):

```
afl-out/ssz_basic/main/
├── crashes/ # Inputs that triggered crashes
├── hangs/   # Inputs that triggered hangs/timeouts
└── queue/   # All interesting inputs (the evolved corpus)
```

Each file in `crashes/` or `hangs/` is a raw byte file that triggered the
issue. The filename encodes metadata about how it was found (e.g.
`id:000000,sig:06,...`).

## Reproducing a Crash

Replay any crashing input by piping it into the harness. The harness embeds AFL's deferred
fork-server marker, so outside afl-fuzz set `__AFL_DEFER_FORKSRV=1` or the runtime aborts
with "forkserver is already up" (`fuzz_run_harness` from `fuzz-env.sh` does this and applies
the clock policy):

```sh
__AFL_DEFER_FORKSRV=1 zig-out/bin/fuzz-ssz_basic < afl-out/ssz_basic/main/crashes/<filename>
```

## Corpus Management

After a fuzzing run, the queues in `afl-out/<target>/<instance>/queue/`
typically contain many redundant inputs. `./fuzz-loop.sh --cmin <target>`
merges them and keeps the smallest subset that preserves full edge coverage in
`corpus/<target>-cmin`; use `afl-tmin` to shrink individual test cases.

> **Important:** The instrumented binary reads input from **stdin**, not
> from file arguments. Do **not** use `@@` with `afl-cmin`, `afl-tmin`,
> or `afl-showmap` — it will cause them to see only the C harness
> coverage (~4 tuples) instead of the Zig SSZ coverage.

### Populating seeds from spec tests

```sh
# Download spec tests first (from project root)
cd ../.. && zig build run:download_spec_tests

# Extract to corpus/-initial directories
cd test/fuzz && zig build extract-corpus
```

### Corpus minimization (`afl-cmin`)

Reduce the evolved queue to a minimal set covering all discovered edges:

```sh
AFL_NO_FORKSRV=1 afl-cmin.bash \
  -i afl-out/ssz_basic/main/queue \
  -o corpus/ssz_basic-cmin \
  -- zig-out/bin/fuzz-ssz_basic
```

`AFL_NO_FORKSRV=1` is required because the Python `afl-cmin` wrapper has
a bug in some AFL++ versions. Use the `afl-cmin.bash` script instead.

### Windows/macOS compatibility

AFL++ output filenames contain colons (e.g., `id:000024,time:0,...`), which
are invalid on Windows (NTFS). After running `afl-cmin`,
rename the output files to replace colons with underscores before committing:

```sh
./corpus/sanitize-filenames.sh
```

### Corpus directories

| Directory                  | Contents                                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `corpus/<target>-initial/` | Hand-crafted seeds + spec test vectors                                                                              |
| `corpus/<target>-cmin/`    | Output of `afl-cmin` (edge-deduplicated corpus); tracked for the SSZ and BLS targets, local for the network targets |

## Container image

`Dockerfile.fuzz` (repository root) packages **every target** into one image,
`ghcr.io/chainsafe/lodestar-z-fuzz`, for the ChainSafe fuzz platform. The
image contains the ReleaseSafe instrumented binaries, the clock shim, `afl-fuzz`,
`afl-cmin` and the seed corpora; the
Zig and LLVM toolchain stays in the build stage. `FUZZ_TARGET` picks the
target a container runs.

### When it is built

The following describes the legacy publisher preserved in the
[imported history](https://github.com/ChainSafe/lodestar/blob/1921c8436ad72e6360d310429830c021ffac0748/.github/workflows/fuzz-image.yml).

| Event                                                                              | Result                                   |
| ---------------------------------------------------------------------------------- | ---------------------------------------- |
| Manual run on `main` (Actions → Fuzz image → Run workflow)                         | build, test, **publish** `main`          |
| Manual run on any other branch                                                     | build, test, **publish** `branch-<name>` |
| Pull request touching `src/`, `pkg/`, `test/fuzz/`, `build.zig*` or the Dockerfile | build and test only                      |

Publishing is manual on purpose. The fuzz platform follows the `main` tag and
restarts every lodestar-z campaign on the new image, so publish once a useful
batch of changes has landed rather than on every commit. Pull requests still
build and test, so a broken `Dockerfile.fuzz` is caught before the next publish.

Each publish is tagged `main` and `sha-<short commit>`; the full commit is also
in the `org.opencontainers.image.revision` label. Only the newest 20 versions are
kept.

A run on another branch publishes `branch-<name>` (lowercased, other characters
turned into `-`) instead of `main`, to try a branch on the platform before it
merges: point a target at that tag, then back at `main` once merged. Only a run
on `main` moves `main`.

### Running it on the fuzz platform

One entry per target in `fuzz_jobs` (lodestar-ansible-development,
`group_vars/fuzzer/vars.yml`), referencing the `main` tag. It never needs editing
when a new image is published. The platform's target names allow hyphens but not
underscores, so write the harness name with hyphens; the entrypoint maps
`ssz-basic` back to `fuzz-ssz_basic`:

```yaml
- project: lodestar-z
  target: ssz-basic # becomes FUZZ_TARGET
  image: ghcr.io/chainsafe/lodestar-z-fuzz:main
  cores: 1
  memory_mb: 2048
  duration: 0
  uid: 61001 # unique per target
  gid: 61001
```

When `main` moves, the platform stops each campaign (`SIGTERM`, so AFL++ saves
its state) and starts it on the new image, resuming from the same corpus. To
freeze a target on one build, for example while investigating a crash, use
`image: ghcr.io/chainsafe/lodestar-z-fuzz@sha256:<digest>` instead; a pinned
target is never switched. To find the commit a campaign is running:

```sh
docker inspect -f '{{ index .Config.Labels "org.opencontainers.image.revision" }}' <image>
```

### What a campaign produces

[`docker/run-fuzz.sh`](docker/run-fuzz.sh) is the entrypoint. It resumes from
the AFL++ state in `$FUZZ_STATE` after any restart, and:

- copies each new crash to `$FUZZ_FAILURES/crash-<hash>` and each hang to
  `hang-<hash>`, deduplicated by content, logging `NEW_CRASH` / `NEW_HANG`;
- logs a `STATS` line every minute;
- writes `$FUZZ_METRICS/status` every minute — executions, coverage, corpus
  size, crashes — which the platform turns into metrics and uses to detect a
  hung campaign.

A campaign's state lives in `$FUZZ_STATE`: `corpus/`, the minimized corpus,
and `afl/`, AFL++'s working directory. A new campaign starts from `corpus/`
when it exists, else from the repository's seeds.

Targets without a seed corpus (`ssz_nested_opaque_proof`,
`ssz_opaque_roundtrip` today) start from a single zero byte and log a warning.

### Minimizing

The image names its minimize command in a label, which the platform requires:

```sh
docker inspect -f '{{ index .Config.Labels "org.chainsafe.fuzz.minimize" }}' <image>
# /opt/fuzz/minimize.sh
```

The platform runs it on a schedule while the campaign is stopped, with the
campaign's environment and volume. [`docker/minimize.sh`](docker/minimize.sh):

1. copies any crash or hang not yet in `$FUZZ_FAILURES`;
2. runs `afl-cmin` over the campaign's queue, the previous `corpus/` and the
   committed seeds, so coverage never drops below what the repository has;
3. swaps the result into `corpus/` and deletes `afl/`, which also drops
   `plot_data` and the stats that grow for as long as a campaign runs. The next
   start fuzzes from `corpus/`.

It exits 0 when done or when there is nothing to minimize. On failure the
state is left as it was, and it is safe to kill at any point. Locally, against
a stopped campaign's volume:

```sh
docker run --rm -e FUZZ_TARGET=ssz_basic -v /tmp/fuzz:/fuzz \
  --entrypoint /opt/fuzz/minimize.sh lodestar-z-fuzz
```

### Locally

```sh
docker build -f Dockerfile.fuzz -t lodestar-z-fuzz .
mkdir -p /tmp/fuzz && docker run --rm -e FUZZ_TARGET=ssz_basic \
  -v /tmp/fuzz:/fuzz lodestar-z-fuzz
```

AFL++ refuses to start if `/proc/sys/kernel/core_pattern` pipes cores to a
handler, as Ubuntu's apport does; set it to `core`, or add
`-e AFL_I_DONT_CARE_ABOUT_MISSING_CRASHES=1` for a quick local run. Replay a
crash with `--init`, or the target runs as PID 1, ignores `SIGABRT`, and the
crash reports as `SIGTRAP`:

```sh
docker run --rm -i --init -e LD_PRELOAD=/opt/fuzz/lib/libfuzz_clock.so \
  --entrypoint /opt/fuzz/bin/fuzz-ssz_basic \
  lodestar-z-fuzz < /tmp/fuzz/failures/crash-<hash>
```

## Adding a New Target

1. Create `src/fuzz_<name>.zig` exporting `zig_fuzz_init` and
   `zig_fuzz_test` with `callconv(.c)`.
2. Add the name to the `fuzzers` array in `build.zig`. If the target links
   against blst (i.e. it uses BLS operations), set extra_libs if you're facing similar situation that bls has: e.g., `.extra_libs = &.{dep_blst.artifact("blst")}`.
3. Create `corpus/<name>-initial/` with hand-crafted seed files.
4. Add the target to `replay-crashes.sh` target list.
5. Nothing else for the container image: it builds every target in `build.zig`.
   To run it on the fuzz platform, add a `fuzz_jobs` entry (see above).

## On MacOs

If you are on macOS, you could temporarily comment these two lines in `pkg/afl++/afl.c`:

```c
__sanitizer_cov_trace_pc_guard_init(&__start___sancov_guards,
                                      &__stop___sancov_guards);
```

On Linux (ELF), the linker automatically synthesizes `__start___sancov_guards`
and `__stop___sancov_guards` symbols for any custom section. On macOS (Mach-O),
these symbols are not automatic — they only exist if the section is present and
non-empty in the final binary. If the Zig-compiled bitcode does not produce the
`__sancov_guards` section in the expected Mach-O layout, the symbols are absent
and calling `__sanitizer_cov_trace_pc_guard_init` crashes at startup.

AFL++ has its own coverage tracking that does not depend on this call, so
commenting it out is safe.
