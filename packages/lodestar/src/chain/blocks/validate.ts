import {computeStartSlotAtEpoch} from "@chainsafe/lodestar-beacon-state-transition";
import {IBlockJob} from "../interface";
import {BlockError, BlockErrorCode} from "../errors";
import {IBeaconClock} from "../clock";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {IForkChoice} from "@chainsafe/lodestar-fork-choice";

export function validateBlock(
  modules: {config: IChainForkConfig; forkChoice: IForkChoice; clock: IBeaconClock},
  job: IBlockJob
): void {
  const {config, forkChoice, clock} = modules;
  const block = job.signedBlock;

  try {
    const blockHash = config.getForkTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message);
    const blockSlot = block.message.slot;
    if (blockSlot === 0) {
      throw new BlockError(block, {code: BlockErrorCode.GENESIS_BLOCK});
    }

    if (!job.reprocess && forkChoice.hasBlock(blockHash)) {
      throw new BlockError(block, {code: BlockErrorCode.BLOCK_IS_ALREADY_KNOWN, root: blockHash});
    }

    const finalizedCheckpoint = forkChoice.getFinalizedCheckpoint();
    const finalizedSlot = computeStartSlotAtEpoch(finalizedCheckpoint.epoch);
    if (blockSlot <= finalizedSlot) {
      throw new BlockError(block, {code: BlockErrorCode.WOULD_REVERT_FINALIZED_SLOT, blockSlot, finalizedSlot});
    }

    const currentSlot = clock.currentSlot;
    if (blockSlot > currentSlot) {
      throw new BlockError(block, {code: BlockErrorCode.FUTURE_SLOT, blockSlot, currentSlot});
    }
  } catch (e) {
    if (e instanceof BlockError) {
      throw e;
    }

    throw new BlockError(block, {code: BlockErrorCode.BEACON_CHAIN_ERROR, error: e as Error});
  }
}
