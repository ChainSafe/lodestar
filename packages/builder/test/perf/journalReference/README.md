# Durable reference journal benchmark

`retainReference` imports immutable, already durable blob sidecars from the primary journal. Grouping the new blob links behind one directory sync removes repeated flushes without changing the durable dependency order:

1. Link and verify the new sidecars, then sync their directory.
2. Link and verify the payload, then sync its directory separately.
3. Write and sync the signed bid file, then rename it and sync the directory.

A partial group is synced before a missing source can fall back to ordinary retention. Uncertain rename or sync failures poison the journal. Existing sidecars need no additional group barrier; existing signed bids and reveal records remain available across recovery.

The unit tests inject source-link failures before and after each link, then exercise snapshot fallback. Separate tests model crashes before and after each rename and durability barrier, replay the last durable directory contents, and check old reveals and payload bytes. These are deterministic durability-order tests, not a physical power-loss test of a filesystem or storage device.

## Reproduce

Use the same immutable production image and baseline compiled builder directory for both variants. Pass only the candidate's compiled `commitmentJournal.js` and adjacent source map; the runner overlays those two leaves for the candidate and records the complete effective compiled builder file maps. Build generated files from source normally before running.

Create a new, empty scratch directory on the filesystem being measured. The runner requires Docker and Linux cgroup v2. It mounts no live journal, keys, network or writable production source. Each fresh container is limited to one CPU and 512 MiB; one run uses less than 32 MiB of unique journal data. Four sequential runs alternate baseline, candidate, candidate, baseline, each covering three samples at 0, 4, 8, 12 and 21 blobs.

```sh
python3 packages/builder/test/perf/journalReference/run.py \
  --image sha256:YOUR_LOCAL_IMAGE_ID \
  --baseline-builder /path/to/baseline/packages/builder/lib \
  --candidate-module /path/to/candidate/packages/builder/lib/services/commitmentJournal.js \
  --scratch-root /path/to/new-empty-scratch-directory \
  --output /path/to/paired-results.json

python3 packages/builder/test/perf/journalReference/summarize.py /path/to/paired-results.json
```

The fixture uses deterministic synthetic payloads and a public test signing key. Each slot prepares an initial reference and then a richer reference reusing the same blobs. All signed revisions and serialized payload, execution-request and blob bytes must recover identically, including across both variants. The workers execute the real journal and retain their normal reply framing. Test-only wrappers time the existing filesystem calls and report over a separate message port.

Preparation, retention, signing, dispatch and individual filesystem operation timings are separate. CPU throttling counters are recorded per operation. The preload adds an `fstat` per open, so its overhead slightly favors fewer directory opens. Blob counts run in ascending order with only two fresh runs per variant, which limits control of ambient I/O. Small synthetic samples include instrumentation and ambient filesystem load; they measure neither gossip delivery nor live win rate. Keep live block/slot evidence separate, and do not infer physical power-loss guarantees beyond the existing filesystem contract.

## Recorded comparison, 2026-10-19

Six samples per variant and blob count, in alternating runs. Initial preparation includes signing and durable reference retention. On the Sepolia XFS filesystem:

| Blobs | Baseline median | Batched median |
| ----- | --------------: | -------------: |
| 0     |        11.19 ms |        9.33 ms |
| 4     |        21.61 ms |       11.72 ms |
| 8     |        31.62 ms |       11.66 ms |
| 12    |        37.52 ms |       11.88 ms |
| 21    |        56.01 ms |       13.83 ms |

On XFS, all 30 candidate initial preparations finished below 25 ms; the maximum was 22.30 ms. One refresh reusing blobs took 31.18 ms, so the publisher's bounded fallback remains necessary. The new-blob directory sync count falls from `blobCount + 2` to three; zero-blob and reused-blob paths retain two directory syncs. Every variant retained one signed-bid file sync.

The Plataberget ext4 timings varied substantially between runs, including paths whose operation count did not change. Its 4-blob median regressed from 35.88 to 44.72 ms, while its 12/21-blob medians improved from 31.94/51.48 to 8.56/11.25 ms. For the regressing 4-blob initial prepare, median directory-sync time rose from 26.64 ms over six syncs to 34.20 ms over three; its reused-blob refresh also rose from 17.62 to 35.41 ms. These observations are consistent with changing ambient I/O load, but do not prove its cause or establish a universal latency improvement. All measured operations avoided CPU throttling, and all 240 signed revisions recovered with matching payload bytes. Full grouped measurements and compiled artifact map hashes are in [results-20261019.json](./results-20261019.json).

## Separate recovery follow-up

The pre-existing constructor counts visible final names during restart and syncs its directory only when it finds temporary files. A process crash after rename but before the directory barrier can leave visible, unsynced final names. Subsequent offer barriers sync them; adding an unconditional startup directory sync is a separate recovery-hardening task, outside this measured change.
