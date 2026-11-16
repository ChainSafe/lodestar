import {ChainForkConfig} from "@lodestar/config";
import {PayloadStatus, ProtoBlock} from "@lodestar/fork-choice";
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
 * - For gloas: verifies bid.parentPayloadRoot matches the tracked payload root; if not, the
 *   previous FULL envelope is treated as orphaned (segment continues as if previous slot was EMPTY)
 * - If an envelope exists for this slot (or the parent's slot): verifies it references this block's root
 * - Advances the tracked payload root (FULL if envelope present, EMPTY if not)
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

  // Track the expected execution payload root through the segment, seeded from the FIRST
  // block's own bid
  const firstBlockMessage = blocks[0].getBlock().message;
  let currentPayloadRoot: string | null = isGloasBeaconBlock(firstBlockMessage)
    ? toRootHex(firstBlockMessage.body.signedExecutionPayloadBid.message.parentPayloadRoot)
    : null;

  // Root of the latest payload of the parent variant: its own payload if FULL, the one it built on otherwise
  let parentPayloadRoot: string | null =
    parentBlock === null
      ? null
      : parentBlock.payloadStatus === PayloadStatus.FULL
        ? parentBlock.payloadRoot
        : parentBlock.parentPayloadRoot;
  if (parentBlock !== null) {
    const parentPayloadInput = payloadEnvelopes?.get(parentBlock.slot);
    if (parentPayloadInput?.hasPayloadEnvelope()) {
      // Envelopes are served by slot, the one at the parent's slot must reference the parent block. Without this
      // check an envelope of a sibling block is taken as orphaned and only fails downstream in the payload import
      if (parentPayloadInput.blockRootHex !== parentBlock.blockRoot) {
        throw new BlockError(blocks[0].getBlock(), {
          code: BlockErrorCode.ENVELOPE_BLOCK_ROOT_MISMATCH,
          envelopeBlockRoot: parentPayloadInput.blockRootHex,
          blockRoot: parentBlock.blockRoot,
        });
      }
      const parentInputPayloadRoot = parentPayloadInput.getPayloadRootHex();
      if (currentPayloadRoot === parentInputPayloadRoot) {
        // Checkpoint-sync first batch: the anchor is stored PENDING with the inherited (grandparent)
        // payload root, its own payload is in this batch and is the real parent EL head
        parentPayloadRoot = parentInputPayloadRoot;
      } else {
        // First block builds on the parent's EMPTY variant, the parent's payload in this batch is orphaned
        warnings.push({slot: parentBlock.slot, payloadEnvelopeInput: parentPayloadInput});
      }
    }
  }

  // First block must build on the parent's EL head. PARENT_PAYLOAD_UNKNOWN (vs the in-segment
  // NON_LINEAR_PAYLOAD_ROOTS below) tells range sync this is a parent-link problem, not an in-batch one.
  if (parentPayloadRoot !== null && currentPayloadRoot !== null && currentPayloadRoot !== parentPayloadRoot) {
    throw new BlockError(blocks[0].getBlock(), {
      code: BlockErrorCode.PARENT_PAYLOAD_UNKNOWN,
      parentRoot: toRootHex(firstBlockMessage.parentRoot),
      parentPayloadRoot: currentPayloadRoot,
    });
  }

  // Track the payload root before the last FULL advancement so we can recover
  // if the next block reveals that envelope was orphaned.
  let prevPayloadRoot: string | null = currentPayloadRoot;
  // The slot whose envelope last advanced currentPayloadRoot (for warning context).
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
      // currentPayloadRoot and prevPayloadRoot are only null for a pre-gloas first block (fork-transition segment); always set post-gloas.
      if (currentPayloadRoot !== null) {
        // Verify the bid's parentPayloadRoot matches the tracked payload root.
        // This ensures the block was built on the correct FULL or EMPTY variant of its parent.
        const bidParentPayloadRoot = toRootHex(block.message.body.signedExecutionPayloadBid.message.parentPayloadRoot);
        if (bidParentPayloadRoot !== currentPayloadRoot) {
          // Maybe the previous slot's FULL envelope was orphaned — try falling back.
          // If even prevPayloadRoot doesn't match, the segment is non-linear.
          if (bidParentPayloadRoot !== prevPayloadRoot) {
            // Broken link inside the segment: throw NON_LINEAR_PAYLOAD_ROOTS instead of PARENT_PAYLOAD_UNKNOWN
            // this is important for range sync to handle accordingly
            throw new BlockError(block, {
              code: BlockErrorCode.NON_LINEAR_PAYLOAD_ROOTS,
              parentPayloadRoot: bidParentPayloadRoot,
              expectedPayloadRoot: currentPayloadRoot,
            });
          }
          if (lastFullSlot !== null && payloadEnvelopes !== null) {
            const orphanedInput = payloadEnvelopes.get(lastFullSlot);
            if (orphanedInput != null) {
              warnings.push({slot: lastFullSlot, payloadEnvelopeInput: orphanedInput});
            }
          }
          currentPayloadRoot = prevPayloadRoot;
        }
      }

      const payloadInput = payloadEnvelopes?.get(slot) ?? null;
      const payloadEnvelope = payloadInput?.hasPayloadEnvelope() ? payloadInput.getPayloadEnvelope() : null;
      if (payloadEnvelope !== null) {
        // Verify the envelope references this block's root
        const blockRoot = toRootHex(config.getForkTypes(slot).BeaconBlock.hashTreeRoot(block.message));
        const envelopeBlockRoot = toRootHex(payloadEnvelope.beaconBlockRoot);
        if (blockRoot !== envelopeBlockRoot) {
          throw new BlockError(block, {
            code: BlockErrorCode.ENVELOPE_BLOCK_ROOT_MISMATCH,
            envelopeBlockRoot,
            blockRoot,
          });
        }

        // FULL variant: save state before advancing, then advance
        prevPayloadRoot = currentPayloadRoot;
        lastFullSlot = slot;
        currentPayloadRoot = toRootHex(block.message.body.signedExecutionPayloadBid.message.payloadRoot);
      }
      // EMPTY variant: currentPayloadRoot unchanged
    }
  }

  return {warnings: warnings.length > 0 ? warnings : null};
}
