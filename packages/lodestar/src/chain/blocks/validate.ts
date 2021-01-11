import {computeStartSlotAtEpoch} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IForkChoice} from "@chainsafe/lodestar-fork-choice";

import {IBlockJob} from "../interface";
import {IBeaconClock} from "../clock";
import {BlockError, BlockErrorCode} from "../errors";

export async function validateBlocks({
  config,
  forkChoice,
  clock,
  jobs,
}: {
  config: IBeaconConfig;
  forkChoice: IForkChoice;
  clock: IBeaconClock;
  jobs: IBlockJob[];
}): Promise<void> {
  if (!jobs || !jobs.length) throw new Error("No block job to validate");
  const ancestorRoot = jobs[0].signedBlock.message.parentRoot;
  let parentRoot = ancestorRoot;
  for (const job of jobs) {
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

      const currentSlot = clock.currentSlot;
      if (blockSlot > currentSlot) {
        throw new BlockError({
          code: BlockErrorCode.FUTURE_SLOT,
          blockSlot,
          currentSlot,
          job,
        });
      }

      if (!config.types.Root.equals(parentRoot, job.signedBlock.message.parentRoot)) {
        throw new BlockError({
          code: BlockErrorCode.NON_LINEAR_PARENT_ROOTS,
          blockSlot,
          job,
        });
      }
      parentRoot = blockHash;
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

  // only validate PARENT_UNKNOWN condition for 1st block
  if (!forkChoice.hasBlock(ancestorRoot)) {
    throw new BlockError({
      code: BlockErrorCode.PARENT_UNKNOWN,
      parentRoot: jobs[0].signedBlock.message.parentRoot.valueOf() as Uint8Array,
      job: jobs[0],
    });
  }
}
