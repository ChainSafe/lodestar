# Validator proofs

Lodestar's proof API lets applications prove validator records and balances without
downloading the whole beacon state. These Lodestar-specific endpoints return
compact Merkle multiproofs:

- `/eth/v0/beacon/proof/state/{state_id}` proves data against a beacon state root.
- `/eth/v0/beacon/proof/block/{block_id}` proves data against an unsigned beacon block root.

See [Compact proof format](./proof-format.md) for the descriptor grammar, JSON and
SSZ encodings, limits, and independent verification vectors.

Enable the `proof` namespace on the node serving requests, alongside any other
namespaces your application needs, for example `--rest.namespace beacon,config,proof`.
For historical state requests, enable `--serveHistoricalState` on the serving node.
This permits reconstruction from retained states and blocks; it does not backfill
missing history. Disabled reconstruction or missing required history produces
`404`; retrying against `head` would prove a different state. Internal failures
remain `500`. See [Serving external consumers](./proof-format.md#serving-external-consumers)
for namespace, syncing, and error behavior.

Historical reconstruction replays retained blocks. If the requested slot was
skipped and no state was saved at that exact slot, reconstruction fails instead
of returning the preceding block's state.

## Choose the root and fork first

Start with a beacon block header authenticated by your application, for example
through a verified light client. Its `stateRoot` is the expected proof root and its
`slot` selects the SSZ types using the network's fork configuration. An arbitrary
header fetched from the same untrusted server does not provide this trust anchor.

Pin that authenticated header. Use its fixed slot for both state requests below,
and verify the proof against its state root. A slot selects a state; it does not
authenticate the response. If the reconstructed root differs from the trusted
header's state root, including after a reorganization, reject the result. Repeated
requests for `head` or `finalized` can resolve to different states.

After skipped slots, a block's parent header can be more than one slot older.
Use that parent's authenticated header slot when proving its state; subtracting
one from the child block's slot can select a different state.

For [EIP-4788](https://eips.ethereum.org/EIPS/eip-4788) consumers, the execution
block's timestamp selects the stored parent beacon block root. Authenticate the
parent header against that root, then use the header's slot and state root for
the state proof. The lookup timestamp does not directly identify the proof's
state slot.

Root-based state requests can also be used when the requested root is available,
but they do not use the same historical reconstruction path as slot-based requests.

Keep your Lodestar packages and network configuration current: Gloas changes the
state layout and uses progressive lists for validators and balances. A generalized
index calculated for Fulu must not be reused for Gloas. Derive indices from SSZ
paths and retain them as `bigint`.

## Request and verify a validator proof

This example uses `@lodestar/api`, `@lodestar/config`, `@lodestar/types`,
`@lodestar/utils`, and `@chainsafe/persistent-merkle-tree`. Pass a client created with
`getClient({baseUrl}, {config})`, the matching network configuration, an authenticated
header, and a validator index to `getValidatorProof`.

```typescript
import {ProofType, Tree, computeDescriptor} from "@chainsafe/persistent-merkle-tree";
import {ApiClient} from "@lodestar/api";
import {ChainForkConfig} from "@lodestar/config";
import {phase0, ssz} from "@lodestar/types";
import {byteArrayEquals} from "@lodestar/utils";

async function getValidatorProof(
  api: ApiClient,
  config: ChainForkConfig,
  header: phase0.BeaconBlockHeader,
  validatorIndex: number
) {
  if (!Number.isSafeInteger(validatorIndex) || validatorIndex < 0) {
    throw new Error("Invalid validator index");
  }

  const stateId = String(header.slot);
  const stateType = config.getForkTypes(header.slot).BeaconState;
  const validatorGindex = stateType.getPathInfo(["validators", validatorIndex]).gindex;
  const balanceGindex = stateType.getPathInfo(["balances", validatorIndex]).gindex;
  // Both ordinary and progressive SSZ lists commit to their length in the right child.
  const lengthGindex = stateType.getPathInfo(["validators"]).gindex * 2n + 1n;
  const descriptor = computeDescriptor([validatorGindex, balanceGindex, lengthGindex]);

  const response = await api.proof.getStateProof({stateId, descriptor});
  const tree = Tree.createFromProof(response.value());
  if (response.meta().version !== config.getForkName(header.slot)) {
    throw new Error("Unexpected proof fork");
  }
  if (!byteArrayEquals(tree.root, header.stateRoot)) {
    throw new Error("Proof does not match the trusted state root");
  }

  const lengthChunk = tree.getNode(lengthGindex).root;
  const validatorCount = new DataView(lengthChunk.buffer, lengthChunk.byteOffset, 32).getBigUint64(0, true);
  if (BigInt(validatorIndex) >= validatorCount) {
    throw new Error("Validator is not present in this state");
  }

  const validatorResponse = await api.beacon.getStateValidator({stateId, validatorId: validatorIndex});
  const {validator} = validatorResponse.value();
  if (!byteArrayEquals(ssz.phase0.Validator.hashTreeRoot(validator), tree.getNode(validatorGindex).root)) {
    throw new Error("Validator record does not match the proven leaf");
  }

  const balanceChunk = tree.getNode(balanceGindex).root;
  const balance = new DataView(balanceChunk.buffer, balanceChunk.byteOffset, 32).getBigUint64(
    (validatorIndex % 4) * 8,
    true
  );
  const proof = tree.getProof({type: ProofType.single, gindex: validatorGindex});
  return {validator, balance, proof, stateRoot: header.stateRoot};
}
```

The record's hash authenticates all its fields, including `withdrawalCredentials`.
The returned single proof contains the validator record root as its leaf and sibling
hashes as witnesses. A proof containing only the record root cannot be expanded into
proofs of its fields.

### Prove withdrawal credentials separately

Lodestar's optimized `Validator` type stops path resolution at the record root.
Calling `BeaconState.getPathInfo(["validators", index, "withdrawalCredentials"])`
does not give the credentials leaf's index. Compose the record's generalized index
with the field index from an ordinary container with the same SSZ fields:

```typescript
import {concatGindices} from "@chainsafe/persistent-merkle-tree";
import {ContainerType} from "@chainsafe/ssz";
import {ChainForkConfig} from "@lodestar/config";
import {ssz} from "@lodestar/types";

function getWithdrawalCredentialsGindex(config: ChainForkConfig, slot: number, validatorIndex: number): bigint {
  const stateType = config.getForkTypes(slot).BeaconState;
  const validatorType = new ContainerType(ssz.phase0.Validator.fields);
  return concatGindices([
    stateType.getPathInfo(["validators", validatorIndex]).gindex,
    validatorType.getPathInfo(["withdrawalCredentials"]).gindex,
  ]);
}
```

Request this index in the descriptor to obtain a proof whose target is the 32-byte
withdrawal credentials. Verify its root and compare the target leaf with the
credentials you expect, using the same root and fork selection as above.

### Decode balances

Balances are packed as four little-endian `uint64` values per 32-byte chunk, in both
Fulu and Gloas. The generalized index selects a chunk; `(validatorIndex % 4) * 8`
selects the balance within it. The returned balance is a `bigint` in Gwei. When
requesting multiple balances, deduplicate their generalized indices before calling
`computeDescriptor`, since adjacent balances can share a chunk.

Proof reconstruction authenticates the requested data against the chosen root. It
does not establish that the root is canonical or finalized. The authenticated header
and your application's finality policy supply those guarantees. Checking the
validator count also prevents treating unused list capacity as an existing validator.

## Block proofs across Gloas

Use `api.proof.getBlockProof({blockId, descriptor})` with an immutable block root and
derive paths from `config.getForkTypes(header.slot).BeaconBlock`. Verify the result
against the unsigned block root, not the signed block root or the state root.

The `stateRoot` field remains available at `["stateRoot"]`. Execution data moves:
Fulu has `["body", "executionPayload", "blockHash"]`, while Gloas has the bid's
commitment at `["body", "signedExecutionPayloadBid", "message", "blockHash"]`.
Proving that commitment is not a proof of the execution payload's contents. Do not
reuse the old execution payload path after the fork.
