# Consensus client interop

Nightly check of Lodestar against the default-branch image of every other consensus client, see
`.github/workflows/cl-interop.yml`. Each client gets a three-node kurtosis devnet (minimal preset, geth behind every
node, blob spam) with Lodestar and the other client crossed over:

- node 1: a Lodestar beacon node without validators, the bootnode a restarted node finds the others through again
- node 2: the other client's beacon node, a Lodestar validator client
- node 3: Lodestar beacon node, the other client's validator client

So every validator duty crosses a client boundary over the beacon API, and the two beacon nodes with validators talk
to each other on the p2p network. Every beacon node subscribes to all subnets, with so few peers a message could
otherwise not be published at all. A client without a beacon node (vero) gets a Lodestar beacon node and validator
client as node 2. The nightly runs the `fulu` scenario, `gloas` is ready in the script and joins once the other
clients are ready for it:

- `fulu`: electra and fulu at genesis, finality 3, then the two beacon nodes with validators are restarted one after
  the other and finality has to advance again
- `gloas`: fulu at genesis and gloas at epoch 2, finality 5

Everything before the first finalized epoch is startup noise and is not judged, and so is the window from a restart
until the restarted beacon node reports itself in sync again. From then on a run fails when:

- finality is not reached in time, or a slot is missed (reported with the proposer's pair), or one node proposes no
  block at all
- a validator of either node misses the attestation target in a judged epoch (reported with the pair and the indices)
- the sync committee or, in `gloas`, the payload timeliness committee fills fewer than 75% of its seats in a block
- the Lodestar beacon node answers a request of the other validator client with an error status, rejects a gossip
  message, hits a req/resp error, loses a peer, or logs an error
- the Lodestar validator client gets an error from the other beacon node, hits a duty, signing or slashing protection
  error, publishes no attestations, aggregates or sync committee messages (payload attestations in `gloas`), is not
  ready at the end, or logs a warning or error
- the two beacon nodes disagree on finality or their heads are more than a slot apart, they are not connected to each
  other at the end, or the other beacon node reports syncing at the end
- a restarted beacon node is not back in sync and connected to the other one within two minutes (the Lodestar beacon
  node is then told to dial the other one so the rest of the run can still be judged)
- no blob was included
- in `gloas`, either head is not on the gloas fork, or the Lodestar beacon node does not serve an archived envelope

The client images float on purpose, the point is to find interop problems before a release. Logs of every container,
metrics snapshots of the Lodestar beacon node and validator client and the verdict of every run are uploaded as
workflow artifacts. The Lodestar beacon node logs the `api` and `rest` modules at debug level and the Lodestar
validator client logs at debug level, so a failed pair comes with the request flow needed to report it.

```sh
# one client locally, keep the enclave for a closer look
KEEP=1 ./scripts/kurtosis/cl-interop/run.sh lighthouse ethpandaops/lighthouse:unstable ethpandaops/lighthouse:unstable fulu
# a validator client without a beacon node
./scripts/kurtosis/cl-interop/run.sh vero - ghcr.io/serenita-org/vero:master gloas
```
