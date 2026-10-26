# AFL++ Fuzzer for lodestar-z

This directory contains [AFL++](https://aflplus.plus/) fuzzing harnesses
for SSZ deserialization in lodestar-z.

## Fuzz Targets

### SSZ

| Target | Binary | Description |
|--------|--------|-------------|
| `ssz_basic` | `fuzz-ssz_basic` | Bool, Uint8/16/32/64/128/256 |
| `ssz_bitlist` | `fuzz-ssz_bitlist` | BitList(8/64/2048) |
| `ssz_bitvector` | `fuzz-ssz_bitvector` | BitVector(4/32/64/512) |
| `ssz_bytelist` | `fuzz-ssz_bytelist` | ByteList(32/256/1024) |
| `ssz_containers` | `fuzz-ssz_containers` | Fork, Checkpoint, Eth1Data, Attestation, etc. |
| `ssz_lists` | `fuzz-ssz_lists` | FixedList(Uint64/32/Bool), VariableList(ByteList) |
| `ssz_chunked_leaf_set` | `fuzz-ssz_chunked_leaf_set` | FixedList(Uint64, chunked_leaf=true): replay set/commit/get op stream, assert root equivalence against fromValue(reference) |

Each SSZ input is `[selector_byte][ssz_data...]`. The first byte selects
which SSZ type to test within the target. See source files for the mapping.

### BLS

| Target | Binary | Description |
|--------|--------|-------------|
| `bls_public_key` | `fuzz-bls_public_key` | Deserialize → validate → serialize roundtrip for `PublicKey` |
| `bls_signature` | `fuzz-bls_signature` | Deserialize → validate → serialize roundtrip for `Signature` |
| `bls_aggregate_pk` | `fuzz-bls_aggregate_pk` | Aggregate multiple `PublicKey`s, with and without randomness |
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
afl-fuzz -i corpus/ssz_basic-cmin -o afl-out/ssz_basic \
  -- zig-out/bin/fuzz-ssz_basic @@
```

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

`fuzz-loop.sh` runs fuzzers in parallel, [minimizes the corpus]()
with `afl-cmin` after each round, and repeats indefinitely:

```sh
./fuzz-loop.sh --help
Usage: ./fuzz-loop.sh [targets...]

Groups:  all, ssz, bls
Targets: ssz_basic ssz_bitlist ssz_bitvector ssz_bytelist ssz_containers ssz_lists bls_public_key bls_signature bls_aggregate_pk bls_aggregate_sig

Examples:
  ./fuzz-loop.sh                    # fuzz all targets
  ./fuzz-loop.sh ssz                # fuzz all SSZ targets
  ./fuzz-loop.sh bls                # fuzz all BLS targets
  ./fuzz-loop.sh ssz bls_signature  # mix groups and individual targets

Environment:
  ROUND_DURATION=3600               # seconds per round (default: 3600)
```

Logs are written to `logs/<target>.log`. Crashes are reported at the end of
each round; run `./replay-crashes.sh` to inspect them.

## Finding Crashes and Hangs

After (or during) a run, results are written to `afl-out/<target>/default/`:

```
afl-out/ssz_basic/default/
├── crashes/ # Inputs that triggered crashes
├── hangs/   # Inputs that triggered hangs/timeouts
└── queue/   # All interesting inputs (the evolved corpus)
```

Each file in `crashes/` or `hangs/` is a raw byte file that triggered the
issue. The filename encodes metadata about how it was found (e.g.
`id:000000,sig:06,...`).

## Reproducing a Crash

Replay any crashing input by piping it into the harness:

```sh
cat afl-out/ssz_basic/default/crashes/<filename> | __AFL_DEFER_FORKSRV=1 zig-out/bin/fuzz-ssz_basic
```

`__AFL_DEFER_FORKSRV=1` is required outside `afl-fuzz`: the harness starts the
fork server itself, and without it the binary aborts with "forkserver is
already up" before reading any input.

## Corpus Management

After a fuzzing run, the queue in `afl-out/<target>/default/queue/` typically
contains many redundant inputs. Use `afl-cmin` to find the smallest
subset that preserves full edge coverage, and `afl-tmin` to shrink
individual test cases.

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
  -i afl-out/ssz_basic/default/queue \
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

| Directory | Contents |
|-----------|----------|
| `corpus/<target>-initial/` | Hand-crafted seeds + spec test vectors |
| `corpus/<target>-cmin/` | Output of `afl-cmin` (edge-deduplicated corpus) |

## Container image

`Dockerfile.fuzz` (repository root) packages **every target** into one image,
`ghcr.io/chainsafe/lodestar-z-fuzz`, for the ChainSafe fuzz platform. The
image contains the instrumented binaries, `afl-fuzz`, `afl-cmin` and the seed corpora; the
Zig and LLVM toolchain stays in the build stage. `FUZZ_TARGET` picks the
target a container runs.

### When it is built

[`.github/workflows/fuzz-image.yml`](../../.github/workflows/fuzz-image.yml):

| Event | Result |
|---|---|
| Manual run on `main` (Actions → Fuzz image → Run workflow) | build, test, **publish** `main` |
| Manual run on any other branch | build, test, **publish** `branch-<name>` |
| Pull request touching `src/`, `pkg/`, `test/fuzz/`, `build.zig*` or the Dockerfile | build and test only |

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
  target: ssz-basic                       # becomes FUZZ_TARGET
  image: ghcr.io/chainsafe/lodestar-z-fuzz:main
  cores: 1
  memory_mb: 2048
  duration: 0
  uid: 61001                              # unique per target
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
docker run --rm -i --init --entrypoint /opt/fuzz/bin/fuzz-ssz_basic \
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

