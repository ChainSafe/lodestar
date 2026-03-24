import {ChainForkConfig} from "@lodestar/config";
import {ProtoBlock} from "@lodestar/fork-choice";
import {Slot, gloas, isGloasBeaconBlock, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {BlockError, BlockErrorCode} from "../../errors/index.js";
import {IBlockInput} from "../blockInput/types.js";

/**
 * Assert this chain segment of blocks is linear with slot numbers and hashes,
 * and that the provided envelopes are consistent with their respective blocks.
 *
 * Must be called after verifyBlocksSanityChecks so that parentBlock (from forkchoice)
 * is available to seed the execution hash chain.
 *
 * For each block:
 * - Verifies parent root + slot linearity
 * - For gloas: verifies bid.parentBlockHash matches the tracked execution hash
 * - If an envelope exists for this slot: verifies it references this block's root
 * - Advances the tracked execution hash (FULL if envelope present, EMPTY if not)
 */
export function assertLinearChainSegment(
  config: ChainForkConfig,
  blocks: IBlockInput[],
  envelopes: Map<Slot, gloas.SignedExecutionPayloadEnvelope> | null,
  parentBlock: ProtoBlock
): void {
  // Track the expected execution payload block hash through the segment.
  // Starts from the known forkchoice parent's execution hash.
  // - FULL variant (envelope present for slot): advances to envelope.payload.blockHash
  // - EMPTY variant (no envelope for slot): execution hash is unchanged
  // null only for pre-merge parents, which cannot precede gloas blocks.
  let currentExecHash: string | null = parentBlock.executionPayloadBlockHash;

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
      // Verify the bid's parentBlockHash matches the tracked execution hash.
      // This ensures the block was built on the correct FULL or EMPTY variant of its parent.
      const bidParentHash = toRootHex(block.message.body.signedExecutionPayloadBid.message.parentBlockHash);
      if (bidParentHash !== currentExecHash) {
        throw new BlockError(block, {
          code: BlockErrorCode.BID_PARENT_HASH_MISMATCH,
          bidParentHash,
          expectedHash: currentExecHash,
        });
      }

      const envelope = envelopes?.get(slot);
      if (envelope !== undefined) {
        // Verify the envelope references this block's root
        const blockRoot = toRootHex(config.getForkTypes(slot).BeaconBlock.hashTreeRoot(block.message));
        const envelopeBlockRoot = toRootHex(envelope.message.beaconBlockRoot);
        if (blockRoot !== envelopeBlockRoot) {
          throw new BlockError(block, {
            code: BlockErrorCode.ENVELOPE_BEACON_BLOCK_ROOT_MISMATCH,
            envelopeBlockRoot,
            blockRoot,
          });
        }

        // FULL variant: advance execution hash to the delivered payload's block hash
        currentExecHash = toRootHex(envelope.message.payload.blockHash);
      }
      // EMPTY variant: currentExecHash unchanged
    }
  }
}
