import {computeStartSlotAtEpoch} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IForkChoice} from "@chainsafe/lodestar-fork-choice";

import {IBlockJob} from "../interface";
import {IBeaconClock} from "../clock";
import {BlockError, BlockErrorCode} from "../errors";

export async function validateBlock({
  config,
  forkChoice,
  clock,
  job,
}: {
  config: IBeaconConfig;
  forkChoice: IForkChoice;
  clock: IBeaconClock;
  job: IBlockJob;
}): Promise<void> {
  try {
    const blockHash = config.types.BeaconBlock.hashTreeRoot(job.signedBlock.message);
    const blockSlot = job.signedBlock.message.slot;
    if (blockSlot === 0) {
      throw new BlockError({
        code: BlockErrorCode.ERR_GENESIS_BLOCK,
        job,
      });
    }
    if (!job.reprocess && forkChoice.hasBlock(blockHash)) {
      throw new BlockError({
        code: BlockErrorCode.ERR_BLOCK_IS_ALREADY_KNOWN,
        job,
      });
    }
    const finalizedCheckpoint = forkChoice.getFinalizedCheckpoint();
    const finalizedSlot = computeStartSlotAtEpoch(config, finalizedCheckpoint.epoch);
    if (blockSlot <= finalizedSlot) {
      throw new BlockError({
        code: BlockErrorCode.ERR_WOULD_REVERT_FINALIZED_SLOT,
        blockSlot,
        finalizedSlot,
        job,
      });
    }
    const currentSlot = clock.currentSlot;
    if (blockSlot > currentSlot) {
      throw new BlockError({
        code: BlockErrorCode.ERR_FUTURE_SLOT,
        blockSlot,
        currentSlot,
        job,
      });
    }
    if (!forkChoice.hasBlock(job.signedBlock.message.parentRoot)) {
      throw new BlockError({
        code: BlockErrorCode.ERR_PARENT_UNKNOWN,
        parentRoot: job.signedBlock.message.parentRoot.valueOf() as Uint8Array,
        job,
      });
    }
  } catch (e) {
    if (e instanceof BlockError) {
      throw e;
    } else {
      throw new BlockError({
        code: BlockErrorCode.ERR_BEACON_CHAIN_ERROR,
        error: e,
        job,
      });
    }
  }
}
