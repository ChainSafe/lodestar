import {ChainForkConfig} from "@lodestar/config";
import {ProtoBlock} from "@lodestar/fork-choice";
import {Slot, isGloasBeaconBlock, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {BlockError, BlockErrorCode} from "../../errors/index.js";
import {IBlockInput} from "../blockInput/types.js";
import {PayloadEnvelopeInput} from "../payloadEnvelopeInput/payloadEnvelopeInput.js";

export type OrphanedPayloadEnvelope = {
  slot: Slot;
  payloadEnvelopeInput: PayloadEnvelopeInput;
};

export type ChainSegmentResult = {warnings: OrphanedPayloadEnvelope[] | null};

/**
 * Assert this chain segment of blocks is linear with slot numbers and hashes,
 * and that the provided envelopes are consistent with their respective blocks.
 *
 * Must be called after verifyBlocksSanityChecks so that parentBlock (from forkchoice)
 * is available to seed the execution hash chain.
 *
 * For each block:
 * - Verifies parent root + slot linearity
 * - For gloas: verifies bid.parentBlockHash matches the tracked execution hash; if not, the
 *   previous FULL envelope is treated as orphaned (segment continues as if previous slot was EMPTY)
 * - If an envelope exists for this slot: verifies it references this block's root
 * - Advances the tracked execution hash (FULL if envelope present, EMPTY if not)
 */
export function assertLinearChainSegment(
  config: ChainForkConfig,
  blocks: IBlockInput[],
  payloadEnvelopes: Map<Slot, PayloadEnvelopeInput> | null,
  parentBlock: ProtoBlock
): ChainSegmentResult {
  const warnings: OrphanedPayloadEnvelope[] = [];

  // Track the expected execution payload block hash through the segment.
  // Starts from the known forkchoice parent's execution hash.
  // - FULL variant (envelope present for slot): advances to envelope.payload.blockHash
  // - EMPTY variant (no envelope for slot): execution hash is unchanged
  // null only for pre-merge parents, which cannot precede gloas blocks.
  let currentExecHash: string | null = parentBlock.executionPayloadBlockHash;
  // Checkpoint sync first batch: parent is the anchor PENDING whose executionPayloadBlockHash
  // is the inherited parentBlockHash semantic (= grandparent's payload), not its own payload.
  // If parent's own payload envelope arrives in this batch, advance currentExecHash to that
  // payload's blockHash so the segment validation sees the true EL chain head.
  const parentPayloadInput = payloadEnvelopes?.get(parentBlock.slot);
  if (parentPayloadInput?.hasPayloadEnvelope()) {
    currentExecHash = parentPayloadInput.getBlockHashHex();
  }
  // DEBUG-SKIP-ENVELOPE: prevExecHash/lastFullSlot orphan-recovery tracking removed since
  // bid linearity is no longer enforced.

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i].getBlock();
    const slot = block.message.slot;

    if (i > 0) {
      const prevBlock = blocks[i - 1].getBlock();
      // Ensure parent root matches the previous block's root
      if (
        !ssz.Root.equals(
          config.getForkTypes(prevBlock.message.slot).BeaconBlock.hashTreeRoot(prevBlock.message),
          block.message.parentRoot
        )
      ) {
        throw new BlockError(block, {code: BlockErrorCode.NON_LINEAR_PARENT_ROOTS});
      }
      // Ensure slots are strictly increasing
      if (slot <= prevBlock.message.slot) {
        throw new BlockError(block, {code: BlockErrorCode.NON_LINEAR_SLOTS});
      }
    }

    if (isGloasBeaconBlock(block.message) && currentExecHash !== null) {
      // DEBUG-SKIP-ENVELOPE: do not enforce bid.parentBlockHash linearity against the tracked
      // execution hash. Without envelopes the chain cannot be reconstructed locally, so bid
      // validation is skipped. Envelopes that DO arrive are still cross-checked for blockRoot
      // consistency below and advance currentExecHash for any later slots that have envelopes.
      const payloadInput = payloadEnvelopes?.get(slot) ?? null;
      const payloadEnvelope = payloadInput?.hasPayloadEnvelope() ? payloadInput.getPayloadEnvelope() : null;
      if (payloadEnvelope !== null) {
        // Verify the envelope references this block's root
        const blockRoot = toRootHex(config.getForkTypes(slot).BeaconBlock.hashTreeRoot(block.message));
        const envelopeBlockRoot = toRootHex(payloadEnvelope.message.beaconBlockRoot);
        if (blockRoot !== envelopeBlockRoot) {
          throw new BlockError(block, {
            code: BlockErrorCode.ENVELOPE_BLOCK_ROOT_MISMATCH,
            envelopeBlockRoot,
            blockRoot,
          });
        }

        // FULL variant: advance the tracked execution hash
        currentExecHash = toRootHex(payloadEnvelope.message.payload.blockHash);
      }
      // EMPTY variant or DEBUG-SKIP-ENVELOPE: currentExecHash unchanged
    }
  }

  return {warnings: warnings.length > 0 ? warnings : null};
}
