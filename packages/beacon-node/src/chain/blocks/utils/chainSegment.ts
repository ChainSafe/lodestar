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
  parentBlock: ProtoBlock | null
): ChainSegmentResult {
  if (blocks.length === 0) {
    return {warnings: null};
  }

  const warnings: OrphanedPayloadEnvelope[] = [];

  let parentExecHash: string | null = parentBlock?.executionPayloadBlockHash ?? null;
  if (parentBlock !== null) {
    const parentPayloadInput = payloadEnvelopes?.get(parentBlock.slot);
    if (parentPayloadInput?.hasPayloadEnvelope()) {
      // Checkpoint-sync first batch: the anchor is stored PENDING with the inherited (grandparent)
      // hash, not its own payload. Its payload envelope is in this batch, so use that blockHash as
      // the real parent EL head.
      parentExecHash = parentPayloadInput.getBlockHashHex();
    }
  }

  // Track the expected execution payload block hash through the segment, seeded from the FIRST
  // block's own bid
  const firstBlockMessage = blocks[0].getBlock().message;
  let currentExecHash: string | null = isGloasBeaconBlock(firstBlockMessage)
    ? toRootHex(firstBlockMessage.body.signedExecutionPayloadBid.message.parentBlockHash)
    : null;

  // First block must build on the parent's EL head. PARENT_PAYLOAD_UNKNOWN (vs the in-segment
  // NON_LINEAR_PAYLOAD_ROOTS below) tells range sync this is a parent-link problem, not an in-batch one.
  if (parentExecHash !== null && currentExecHash !== null && currentExecHash !== parentExecHash) {
    throw new BlockError(blocks[0].getBlock(), {
      code: BlockErrorCode.PARENT_PAYLOAD_UNKNOWN,
      parentRoot: toRootHex(firstBlockMessage.parentRoot),
      parentBlockHash: currentExecHash,
    });
  }

  // Track the execution hash before the last FULL advancement so we can recover
  // if the next block reveals that envelope was orphaned.
  let prevExecHash: string | null = currentExecHash;
  // The slot whose envelope last advanced currentExecHash (for warning context).
  let lastFullSlot: Slot | null = null;

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

    if (isGloasBeaconBlock(block.message)) {
      // currentExecHash and prevExecHash are only null for a pre-gloas first block (fork-transition segment); always set post-gloas.
      if (currentExecHash !== null) {
        // Verify the bid's parentBlockHash matches the tracked execution hash.
        // This ensures the block was built on the correct FULL or EMPTY variant of its parent.
        const bidParentHash = toRootHex(block.message.body.signedExecutionPayloadBid.message.parentBlockHash);
        if (bidParentHash !== currentExecHash) {
          // Maybe the previous slot's FULL envelope was orphaned — try falling back.
          // If even prevExecHash doesn't match, the segment is non-linear.
          if (bidParentHash !== prevExecHash) {
            // Broken link inside the segment: throw NON_LINEAR_PAYLOAD_ROOTS instead of PARENT_PAYLOAD_UNKNOWN
            // this is important for range sync to handle accordingly
            throw new BlockError(block, {
              code: BlockErrorCode.NON_LINEAR_PAYLOAD_ROOTS,
              parentBlockHash: bidParentHash,
              expectedBlockHash: currentExecHash,
            });
          }
          if (lastFullSlot !== null && payloadEnvelopes !== null) {
            const orphanedInput = payloadEnvelopes.get(lastFullSlot);
            if (orphanedInput != null) {
              warnings.push({slot: lastFullSlot, payloadEnvelopeInput: orphanedInput});
            }
          }
          currentExecHash = prevExecHash;
        }
      }

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

        // FULL variant: save state before advancing, then advance
        prevExecHash = currentExecHash;
        lastFullSlot = slot;
        currentExecHash = toRootHex(payloadEnvelope.message.payload.blockHash);
      }
      // EMPTY variant: currentExecHash unchanged
    }
  }

  return {warnings: warnings.length > 0 ? warnings : null};
}
