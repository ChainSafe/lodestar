import {computeEpochAtSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IForkChoice} from "@chainsafe/lodestar-fork-choice";
import {
  getAllBlockSignatureSets,
  getAllBlockSignatureSetsExceptProposer,
  ISignatureSet,
} from "@chainsafe/lodestar-beacon-state-transition/lib/fast/signatureSets";

import {ChainEventEmitter} from "../emitter";
import {IBlockJob, IChainSegmentJob} from "../interface";
import {runStateTransition} from "./stateTransition";
import {IStateRegenerator, RegenError} from "../regen";
import {BlockError, BlockErrorCode, ChainSegmentError} from "../errors";
import {IBeaconDb} from "../../db";
import {verifySignatureSetsBatch} from "../bls";

export async function processBlock({
  forkChoice,
  regen,
  emitter,
  db,
  job,
}: {
  forkChoice: IForkChoice;
  regen: IStateRegenerator;
  emitter: ChainEventEmitter;
  db: IBeaconDb;
  job: IBlockJob;
}): Promise<void> {
  if (!forkChoice.hasBlock(job.signedBlock.message.parentRoot)) {
    throw new BlockError({
      code: BlockErrorCode.PARENT_UNKNOWN,
      parentRoot: job.signedBlock.message.parentRoot.valueOf() as Uint8Array,
      job,
    });
  }

  try {
    const preStateContext = await regen.getPreState(job.signedBlock.message);

    if (!job.validSignatures) {
      const {epochCtx, state} = preStateContext;
      const signatureSets = job.validProposerSignature
        ? getAllBlockSignatureSetsExceptProposer(epochCtx, state, job.signedBlock)
        : getAllBlockSignatureSets(epochCtx, state, job.signedBlock);

      if (!verifySignatureSetsBatch(signatureSets)) {
        throw new BlockError({
          code: BlockErrorCode.INVALID_SIGNATURE,
          job,
        });
      }

      job.validProposerSignature = true;
      job.validSignatures = true;
    }

    await runStateTransition(emitter, forkChoice, db, preStateContext, job);
  } catch (e) {
    if (e instanceof RegenError) {
      throw new BlockError({
        code: BlockErrorCode.PRESTATE_MISSING,
        job,
      });
    }

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

export async function processChainSegment({
  config,
  forkChoice,
  regen,
  emitter,
  db,
  job,
}: {
  config: IBeaconConfig;
  forkChoice: IForkChoice;
  regen: IStateRegenerator;
  emitter: ChainEventEmitter;
  db: IBeaconDb;
  job: IChainSegmentJob;
}): Promise<void> {
  let importedBlocks = 0;
  let blocks = job.signedBlocks;

  // Process segment epoch by epoch
  while (blocks.length) {
    const firstBlock = blocks[0];
    // First ensure that the segment's parent has been processed
    if (!forkChoice.hasBlock(firstBlock.message.parentRoot)) {
      throw new ChainSegmentError({
        code: BlockErrorCode.PARENT_UNKNOWN,
        parentRoot: firstBlock.message.parentRoot.valueOf() as Uint8Array,
        job,
        importedBlocks,
      });
    }
    const startEpoch = computeEpochAtSlot(config, firstBlock.message.slot);

    const findLastIndex = <T>(array: T[], predicate: (value: T) => boolean): number => {
      let i = array.length;
      while (i--) {
        if (predicate(array[i])) {
          return i;
        }
      }
      return -1;
    };
    // The `lastIndex` indicates the position of the last block that is in the current
    // epoch of `startEpoch`.
    const lastIndex = findLastIndex(blocks, (block) => computeEpochAtSlot(config, block.message.slot) === startEpoch);

    // Split off the first section blocks that are all either within the current epoch of
    // the first block. These blocks can all be signature-verified with the same
    // `BeaconState`.
    const blocksInEpoch = blocks.slice(0, lastIndex);
    blocks = blocks.slice(lastIndex);

    try {
      let preStateContext = await regen.getPreState(firstBlock.message);

      // Verify the signature of the blocks, returning early if the signature is invalid.
      if (!job.validSignatures) {
        const signatureSets: ISignatureSet[] = [];
        for (const block of blocksInEpoch) {
          const {epochCtx, state} = preStateContext;
          signatureSets.push(
            ...(job.validProposerSignature
              ? getAllBlockSignatureSetsExceptProposer(epochCtx, state, block)
              : getAllBlockSignatureSets(epochCtx, state, block))
          );
        }

        if (!verifySignatureSetsBatch(signatureSets)) {
          throw new ChainSegmentError({
            code: BlockErrorCode.INVALID_SIGNATURE,
            job,
            importedBlocks,
          });
        }
      }

      for (const block of blocksInEpoch) {
        preStateContext = await runStateTransition(emitter, forkChoice, db, preStateContext, {
          reprocess: job.reprocess,
          prefinalized: job.prefinalized,
          signedBlock: block,
          validProposerSignature: true,
          validSignatures: true,
        });
        importedBlocks++;
      }
    } catch (e) {
      if (e instanceof RegenError) {
        throw new ChainSegmentError({
          code: BlockErrorCode.PRESTATE_MISSING,
          job,
          importedBlocks,
        });
      }

      if (e instanceof BlockError) {
        throw new ChainSegmentError({
          ...e.type,
          job,
          importedBlocks,
        });
      }

      throw new ChainSegmentError({
        code: BlockErrorCode.BEACON_CHAIN_ERROR,
        error: e,
        job,
        importedBlocks,
      });
    }
  }
}
