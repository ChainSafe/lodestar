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
        code: BlockErrorCode.GENESIS_BLOCK,
        job,
      });
    }

    if (!job.reprocess && forkChoice.hasBlock(blockHash)) {
      throw new BlockError({
        code: BlockErrorCode.BLOCK_IS_ALREADY_KNOWN,
        job,
      });
    }

    const finalizedCheckpoint = forkChoice.getFinalizedCheckpoint();
    const finalizedSlot = computeStartSlotAtEpoch(config, finalizedCheckpoint.epoch);
    if (blockSlot <= finalizedSlot) {
      throw new BlockError({
        code: BlockErrorCode.WOULD_REVERT_FINALIZED_SLOT,
        blockSlot,
        finalizedSlot,
        job,
      });
    }

    const maxPeerCurrentSlot = clock.maxPeerCurrentSlot;
    if (blockSlot > maxPeerCurrentSlot) {
      throw new BlockError({
        code: BlockErrorCode.FUTURE_SLOT,
        blockSlot,
        currentSlot: maxPeerCurrentSlot,
        job,
      });
    }

    if (!forkChoice.hasBlock(job.signedBlock.message.parentRoot)) {
      throw new BlockError({
        code: BlockErrorCode.PARENT_UNKNOWN,
        parentRoot: job.signedBlock.message.parentRoot.valueOf() as Uint8Array,
        job,
      });
    }
  } catch (e) {
    if (e instanceof BlockError) {
      throw e;
    }

    throw new BlockError({
      code: BlockErrorCode.BEACON_CHAIN_ERROR,
      error: e,
      job,
    });
  }
}
