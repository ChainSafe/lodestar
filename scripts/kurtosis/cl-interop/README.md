# Consensus client interop

Nightly check of Lodestar against the default-branch image of every other consensus client, see
`.github/workflows/cl-interop.yml`. Each client gets a three-node kurtosis devnet (minimal preset, geth behind every
node, blob spam) with Lodestar and the other client crossed over:

- node 1: a Lodestar beacon node without validators, the bootnode of the package and a second Lodestar view of the
  other client
- node 2: the other client's beacon node, a Lodestar validator client
- node 3: Lodestar beacon node, the other client's validator client

So every validator duty crosses a client boundary over the beacon API, and the two beacon nodes with validators talk
to each other on the p2p network. Every beacon node subscribes to all subnets, with so few peers a message could
otherwise not be published at all. A client without a beacon node (vero) gets a Lodestar beacon node and validator
client as node 2, a client the package cannot run as a separate validator client (grandine) gets Lodestar on both
sides of node 3. The nightly runs the `fulu` scenario, `gloas` is ready in the script and joins once the other
clients are ready for it. The Nimbus validator client runs with doppelganger detection off until
status-im/nimbus-eth2#9278 is fixed, it would otherwise exit on its own epoch 0 block proposal:

- `fulu`: electra and fulu at genesis, finality 4
- `gloas`: fulu at genesis and gloas at epoch 2, finality 5

Everything before the first finalized epoch is startup noise and is not judged. From then on a run fails when:

- finality is not reached in time, or a slot is missed (reported with the proposer's pair), or one node proposes no
  block at all
- a validator of either node misses the attestation target in a judged epoch (reported with the pair and the indices),
  or a pair hits the head with fewer than 90% of its attestations over the judged epochs
- the sync committee or, in `gloas`, the payload timeliness committee fills fewer than 75% of its seats in a block
- the Lodestar beacon node answers a request of the other validator client with an error status, rejects a gossip
  message, hits a req/resp error, loses a peer, or logs an error
- the Lodestar validator client gets an error from the other beacon node, hits a duty, signing or slashing protection
  error, publishes no attestations, aggregates or sync committee messages (payload attestations in `gloas`), is not
  ready at the end, or logs a warning or error
- the two beacon nodes disagree on finality or their heads are more than a slot apart, they are not connected to each
  other at the end, or the other beacon node reports syncing at the end
- no blob was included
- in `gloas`, either head is not on the gloas fork, or the Lodestar beacon node does not serve an archived envelope

A failure with a known cause, on either side, is listed in `known-issues.mjs`: the client, a pattern for the failure
text, optionally a log file and a pattern that has to confirm the cause, a note and the link to the issue. A matching
failure shows up as a known issue in the summary row and does not fail the job, anything else on that pair still does.
Remove the entry once the fix is in the image the nightly runs.

The client images float on purpose, the point is to find interop problems before a release. Logs of every container,
metrics snapshots of the Lodestar beacon node and validator client and the verdict of every run are uploaded as
workflow artifacts. The Lodestar beacon node logs the `api` and `rest` modules at debug level and the Lodestar
validator client logs at debug level, so a failed pair comes with the request flow needed to report it.

```sh
# one client locally, keep the enclave for a closer look
KEEP=1 ./scripts/kurtosis/cl-interop/run.sh lighthouse ethpandaops/lighthouse:unstable ethpandaops/lighthouse:unstable fulu
# a validator client without a beacon node, and a beacon node without a separate validator client
./scripts/kurtosis/cl-interop/run.sh vero - ghcr.io/serenita-org/vero:master fulu
./scripts/kurtosis/cl-interop/run.sh grandine ethpandaops/grandine:develop-minimal - fulu
```
