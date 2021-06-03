import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IForkChoice} from "@chainsafe/lodestar-fork-choice";
import {sleep} from "@chainsafe/lodestar-utils";
import {ChainEventEmitter} from "../emitter";
import {IBlockJob, IChainSegmentJob} from "../interface";
import {runStateTransition} from "./stateTransition";
import {IStateRegenerator, RegenError} from "../regen";
import {BlockError, BlockErrorCode, ChainSegmentError} from "../errors";
import {IBlsVerifier} from "../bls";
import {groupBlocksByEpoch} from "./util";
import {allForks, ISignatureSet, CachedBeaconState} from "@chainsafe/lodestar-beacon-state-transition";
import {CheckpointStateCache} from "../stateCache";
import {IMetrics} from "../../metrics";

export type BlockProcessOpts = {
  /**
   * Do not use BLS batch verify to validate all block signatures at once.
   * Will double processing times. Use only for debugging purposes.
   */
  disableBlsBatchVerify?: boolean;
};

export type BlockProcessModules = {
  bls: IBlsVerifier;
  checkpointStateCache: CheckpointStateCache;
  config: IBeaconConfig;
  emitter: ChainEventEmitter;
  forkChoice: IForkChoice;
  metrics: IMetrics | null;
  regen: IStateRegenerator;
  opts?: BlockProcessOpts;
};

export async function processBlock(
  {forkChoice, regen, emitter, checkpointStateCache, bls, metrics, opts}: BlockProcessModules,
  job: IBlockJob
): Promise<void> {
  if (!forkChoice.hasBlock(job.signedBlock.message.parentRoot)) {
    throw new BlockError({
      code: BlockErrorCode.PARENT_UNKNOWN,
      parentRoot: job.signedBlock.message.parentRoot.valueOf() as Uint8Array,
      job,
    });
  }

  try {
    const preState = await regen.getPreState(job.signedBlock.message);

    if (!job.validSignatures && !opts?.disableBlsBatchVerify) {
      const signatureSets = job.validProposerSignature
        ? allForks.getAllBlockSignatureSetsExceptProposer(
            preState as CachedBeaconState<allForks.BeaconState>,
            job.signedBlock
          )
        : allForks.getAllBlockSignatureSets(preState as CachedBeaconState<allForks.BeaconState>, job.signedBlock);

      if (signatureSets.length > 0 && !(await bls.verifySignatureSets(signatureSets))) {
        throw new BlockError({
          code: BlockErrorCode.INVALID_SIGNATURE,
          job,
        });
      }

      job.validProposerSignature = true;
      job.validSignatures = true;
    }

    await runStateTransition({emitter, forkChoice, metrics}, checkpointStateCache, preState, job);
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
      error: e as Error,
      job,
    });
  }
}

export async function processChainSegment(
  {config, forkChoice, regen, emitter, checkpointStateCache, bls, metrics, opts}: BlockProcessModules,
  job: IChainSegmentJob
): Promise<void> {
  let importedBlocks = 0;
  const blocks = job.signedBlocks;

  const firstSegBlock = blocks[0];
  if (firstSegBlock) {
    // First ensure that the segment's parent has been processed
    if (!forkChoice.hasBlock(firstSegBlock.message.parentRoot)) {
      throw new ChainSegmentError({
        code: BlockErrorCode.PARENT_UNKNOWN,
        parentRoot: firstSegBlock.message.parentRoot.valueOf() as Uint8Array,
        job,
        importedBlocks,
      });
    }
  }

  // Split off the first section blocks that are all either within the current epoch of
  // the first block. These blocks can all be signature-verified with the same
  // `BeaconState`.
  const blocksByEpoch = groupBlocksByEpoch(config, blocks);

  // Process segment epoch by epoch
  for (const blocksInEpoch of blocksByEpoch) {
    const firstBlock = blocksInEpoch[0];
    if (!firstBlock) {
      continue;
    }

    try {
      // It's important to process up to block slot to get through signature verification at fork transition
      let preState = await regen.getBlockSlotState(firstBlock.message.parentRoot, firstBlock.message.slot);

      // Verify the signature of the blocks, returning early if the signature is invalid.
      if (!job.validSignatures && !opts?.disableBlsBatchVerify) {
        const signatureSets: ISignatureSet[] = [];
        for (const block of blocksInEpoch) {
          signatureSets.push(
            ...(job.validProposerSignature
              ? allForks.getAllBlockSignatureSetsExceptProposer(preState, block)
              : allForks.getAllBlockSignatureSets(preState as CachedBeaconState<allForks.BeaconState>, block))
          );
        }

        if (signatureSets.length > 0 && !(await bls.verifySignatureSets(signatureSets))) {
          throw new ChainSegmentError({
            code: BlockErrorCode.INVALID_SIGNATURE,
            job,
            importedBlocks,
          });
        }
      }

      for (const block of blocksInEpoch) {
        preState = await runStateTransition({emitter, forkChoice, metrics}, checkpointStateCache, preState, {
          reprocess: job.reprocess,
          prefinalized: job.prefinalized,
          signedBlock: block,
          validProposerSignature: true,
          validSignatures: true,
        });
        importedBlocks++;
        // this avoids keeping our node busy processing blocks
        await sleep(0);
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
        error: e as Error,
        job,
        importedBlocks,
      });
    }
  }
}
