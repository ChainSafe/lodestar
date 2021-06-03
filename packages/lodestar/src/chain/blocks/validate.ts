import {computeStartSlotAtEpoch} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IForkChoice} from "@chainsafe/lodestar-fork-choice";

import {IBlockJob} from "../interface";
import {IBeaconClock} from "../clock";
import {BlockError, BlockErrorCode} from "../errors";

export type BlockValidateModules = {
  config: IBeaconConfig;
  forkChoice: IForkChoice;
  clock: IBeaconClock;
};

export function validateBlock({config, forkChoice, clock}: BlockValidateModules, job: IBlockJob): void {
  try {
    const blockHash = config
      .getForkTypes(job.signedBlock.message.slot)
      .BeaconBlock.hashTreeRoot(job.signedBlock.message);
    const blockSlot = job.signedBlock.message.slot;
    if (blockSlot === 0) {
      throw new BlockError({
        code: BlockErrorCode.GENESIS_BLOCK,
        job,
      });
    }

    if (!job.reprocess && forkChoice.hasBlock(blockHash)) {
      throw new BlockError({
        code: BlockErrorCode.BLOCK_IS_ALREADY_KNOWN,
        root: blockHash,
        job,
      });
    }

    const finalizedCheckpoint = forkChoice.getFinalizedCheckpoint();
    const finalizedSlot = computeStartSlotAtEpoch(finalizedCheckpoint.epoch);
    if (blockSlot <= finalizedSlot) {
      throw new BlockError({
        code: BlockErrorCode.WOULD_REVERT_FINALIZED_SLOT,
        blockSlot,
        finalizedSlot,
        job,
      });
    }

    const currentSlot = clock.currentSlot;
    if (blockSlot > currentSlot) {
      throw new BlockError({
        code: BlockErrorCode.FUTURE_SLOT,
        blockSlot,
        currentSlot,
        job,
      });
    }
  } catch (e) {
    if (e instanceof BlockError) {
      throw e;
    }

    throw new BlockError({
      code: BlockErrorCode.BEACON_CHAIN_ERROR,
      error: e as Error,
      job,
    });
  }
}
