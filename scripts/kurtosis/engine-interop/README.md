# Engine API interop

Nightly check of Lodestar against the default-branch image of every execution client, see
`.github/workflows/engine-interop.yml`. Each client gets a two-node kurtosis devnet (minimal preset, blob spam,
node 1 is a non-supernode that fetches blobs from its EL, node 2 a supernode) and two scenarios:

- `fulu`: electra and fulu at genesis, finality 3, then the second EL is restarted and finality has to advance again
- `gloas`: fulu at genesis and gloas at epoch 2, finality 5, archived payload envelopes rebuilt from EL bodies

Everything before the first finalized epoch is startup noise and is not judged. From then on a run fails when:

- finality is not reached in time, or a slot is missed after the first epoch
- an engine request errors, or `newPayload` or `forkchoiceUpdated` returns anything but `VALID`
- the execution module logs a warning or error, including every REST to JSON-RPC fallback
- a node that negotiated REST sends a request over JSON-RPC, or the two nodes settled on different transports
- a `getBlobs` call fails, or the supernode never resolved blobs through the engine API
- in `gloas`, the head is not on the gloas fork, or an archived envelope is not rebuilt through EL bodies

The EL images float on purpose, the point is to find interop problems before a release. Logs, metrics snapshots,
the capabilities document and the verdict of every run are uploaded as workflow artifacts.

```sh
# one client locally, keep the enclave for a closer look
KEEP=1 LODESTAR_IMAGE=chainsafe/lodestar:next ./scripts/kurtosis/engine-interop/run.sh reth ethpandaops/reth:main fulu
```
