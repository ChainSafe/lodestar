import {BeaconConfig} from "@lodestar/config";
import {BUILDER_INDEX_SELF_BUILD, GENESIS_SLOT} from "@lodestar/params";
import {
  ISignatureSet,
  computeEpochAtSlot,
  createIndexedSignatureSetFromComponents,
  createSingleSignatureSetFromComponents,
  getBlockProposerSignatureSet,
  getExecutionPayloadEnvelopeSigningRoot,
} from "@lodestar/state-transition";
import {BuilderIndex, Root, SignedBeaconBlock, Slot, gloas, ssz} from "@lodestar/types";
import {byteArrayEquals, toRootHex} from "@lodestar/utils";
import {IBlsVerifier} from "../../chain/bls/index.js";
import {BackfillSyncError, BackfillSyncErrorCode} from "./errors.js";

export type BackfillBlock = {block: SignedBeaconBlock; blockRoot: Uint8Array};

/**
 * Check that `blocks` (ascending) are within `[startSlot, endSlot)` and form a chain whose last block is
 * `expectedRoot`, the parent of the earliest block already stored.
 *
 * The response may start above `startSlot` but must not end short: any block between the last one returned
 * and `endSlot` would have to be an ancestor of the stored block, so the last one returned is its parent.
 */
export function assertLinearChainToRoot(
  config: BeaconConfig,
  blocks: SignedBeaconBlock[],
  expectedRoot: Root,
  startSlot: Slot,
  endSlot: Slot
): BackfillBlock[] {
  const verified = new Array<BackfillBlock>(blocks.length);
  let childSlot = endSlot;
  let childParentRoot = expectedRoot;

  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    const slot = block.message.slot;
    if (slot < startSlot || slot >= endSlot) {
      throw new BackfillSyncError({code: BackfillSyncErrorCode.OUT_OF_RANGE_BLOCK, slot, startSlot, endSlot});
    }
    if (slot >= childSlot) {
      throw new BackfillSyncError({code: BackfillSyncErrorCode.OUT_OF_ORDER_BLOCKS, slot});
    }

    const blockRoot = config.getForkTypes(slot).BeaconBlock.hashTreeRoot(block.message);
    if (!byteArrayEquals(blockRoot, childParentRoot)) {
      throw new BackfillSyncError({
        code: BackfillSyncErrorCode.NOT_LINEAR,
        slot,
        expected: toRootHex(childParentRoot),
        actual: toRootHex(blockRoot),
      });
    }

    verified[i] = {block, blockRoot};
    childSlot = slot;
    childParentRoot = block.message.parentRoot;
  }

  return verified;
}

/**
 * The signature is not part of the block root, so a chain of valid roots can still carry corrupted signatures.
 * See https://github.com/ethereum/consensus-specs/blob/master/specs/phase0/p2p-interface.md#why-must-the-proposer-signature-be-checked-when-backfilling-blocks-in-the-database
 *
 * Proposer duty is not checked, the block root already commits to the proposer index. The validator registry is
 * append-only, so `pubkeyCount` of any later state covers every historical proposer.
 */
export async function verifyProposerSignatures(
  config: BeaconConfig,
  bls: IBlsVerifier,
  pubkeyCount: number,
  blocks: BackfillBlock[]
): Promise<void> {
  const signatureSets: ISignatureSet[] = [];
  for (const {block} of blocks) {
    // The genesis block is never signed
    if (block.message.slot === GENESIS_SLOT) continue;

    if (block.message.proposerIndex >= pubkeyCount) {
      throw new BackfillSyncError({
        code: BackfillSyncErrorCode.UNKNOWN_PROPOSER,
        slot: block.message.slot,
        proposerIndex: block.message.proposerIndex,
      });
    }
    signatureSets.push(getBlockProposerSignatureSet(config, block));
  }

  if (signatureSets.length > 0 && !(await bls.verifySignatureSets(signatureSets, {batchable: true}))) {
    throw new BackfillSyncError({
      code: BackfillSyncErrorCode.INVALID_PROPOSER_SIGNATURE,
      startSlot: blocks[0].block.message.slot,
      count: blocks.length,
    });
  }
}

/**
 * Checks of `verify_execution_payload_envelope` that need no state: the envelope belongs to the block and
 * reveals the payload of its bid, which the proposer signature covers.
 * See `verify_execution_payload_envelope_consistency` in https://github.com/ethereum/consensus-specs/pull/5771
 */
export function assertEnvelopeConsistency(
  envelope: gloas.ExecutionPayloadEnvelope,
  block: gloas.BeaconBlock,
  blockRoot: Root
): void {
  const {payload} = envelope;
  const bid = block.body.signedExecutionPayloadBid.message;
  const checks: [field: string, isConsistent: boolean][] = [
    ["beaconBlockRoot", byteArrayEquals(envelope.beaconBlockRoot, blockRoot)],
    ["parentBeaconBlockRoot", byteArrayEquals(envelope.parentBeaconBlockRoot, block.parentRoot)],
    ["builderIndex", envelope.builderIndex === bid.builderIndex],
    ["prevRandao", byteArrayEquals(payload.prevRandao, bid.prevRandao)],
    ["gasLimit", BigInt(payload.gasLimit) === bid.gasLimit],
    ["blockHash", byteArrayEquals(payload.blockHash, bid.blockHash)],
    [
      "executionRequests",
      byteArrayEquals(ssz.gloas.ExecutionRequests.hashTreeRoot(envelope.executionRequests), bid.executionRequestsRoot),
    ],
    ["slotNumber", payload.slotNumber === block.slot],
    ["parentHash", byteArrayEquals(payload.parentHash, bid.parentBlockHash)],
  ];
  const inconsistentField = checks.find(([, isConsistent]) => !isConsistent)?.[0] ?? null;

  if (inconsistentField !== null) {
    throw new BackfillSyncError({
      code: BackfillSyncErrorCode.INCONSISTENT_ENVELOPE,
      slot: block.slot,
      root: toRootHex(blockRoot),
      field: inconsistentField,
    });
  }
}

/**
 * Builder indices are reused, so without the historical state only the proposer of a self-built payload and a
 * builder registered before the envelope's epoch are known to be its signer. Returns null for any other
 * envelope, its signature can't be verified.
 */
export function getBackfillEnvelopeSignatureSet(
  config: BeaconConfig,
  signedEnvelope: gloas.SignedExecutionPayloadEnvelope,
  block: gloas.BeaconBlock,
  getBuilder: (builderIndex: BuilderIndex) => gloas.Builder | null
): ISignatureSet | null {
  const {builderIndex} = signedEnvelope.message;
  const signingRoot = getExecutionPayloadEnvelopeSigningRoot(config, signedEnvelope.message);

  if (builderIndex === BUILDER_INDEX_SELF_BUILD) {
    return createIndexedSignatureSetFromComponents(block.proposerIndex, signingRoot, signedEnvelope.signature);
  }

  const builder = getBuilder(builderIndex);
  if (builder === null || builder.depositEpoch >= computeEpochAtSlot(block.slot)) {
    return null;
  }
  return createSingleSignatureSetFromComponents(builder.pubkey, signingRoot, signedEnvelope.signature);
}
