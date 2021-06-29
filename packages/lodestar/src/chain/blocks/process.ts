import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IForkChoice} from "@chainsafe/lodestar-fork-choice";
import {sleep} from "@chainsafe/lodestar-utils";
import {ChainEventEmitter} from "../emitter";
import {IBlockJob, IChainSegmentJob, IProcessBlock} from "../interface";
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

export async function processBlock(modules: BlockProcessModules, job: IBlockJob): Promise<void> {
  const {forkChoice} = modules;

  if (!forkChoice.hasBlock(job.signedBlock.message.parentRoot)) {
    throw new BlockError(job.signedBlock, {
      code: BlockErrorCode.PARENT_UNKNOWN,
      parentRoot: job.signedBlock.message.parentRoot.valueOf() as Uint8Array,
    });
  }

  await processBlocksInEpoch(modules, job, [job.signedBlock]);
}

export async function processChainSegment(modules: BlockProcessModules, job: IChainSegmentJob): Promise<void> {
  const {config, forkChoice} = modules;
  const blocks = job.signedBlocks;

  const firstSegBlock = blocks[0];
  if (firstSegBlock) {
    // First ensure that the segment's parent has been processed
    if (!forkChoice.hasBlock(firstSegBlock.message.parentRoot)) {
      throw new ChainSegmentError({
        code: BlockErrorCode.PARENT_UNKNOWN,
        parentRoot: firstSegBlock.message.parentRoot.valueOf() as Uint8Array,
        job,
        importedBlocks: 0,
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

    let importedBlocks = 0;

    try {
      await processBlocksInEpoch(modules, job, blocksInEpoch, () => importedBlocks++);
    } catch (e) {
      if (e instanceof BlockError) {
        throw new ChainSegmentError({...e.type, job, importedBlocks});
      }

      throw new ChainSegmentError({code: BlockErrorCode.BEACON_CHAIN_ERROR, error: e as Error, job, importedBlocks});
    }
  }
}

/**
 * Process sequential blocks all in the same epoch. Their signatures may be verified in batch, thus all blocks
 * must be in the same epoch to recycle the shuffling.
 *
 * This function can be used to validate one (processBlock) or more blocks (processChainSegment)
 */
async function processBlocksInEpoch(
  {forkChoice, regen, emitter, checkpointStateCache, bls, metrics, opts}: BlockProcessModules,
  job: IProcessBlock,
  blocksInEpoch: allForks.SignedBeaconBlock[],
  onProcessBlock?: (block: allForks.SignedBeaconBlock) => void
): Promise<void> {
  const firstBlock = blocksInEpoch[0];
  if (!firstBlock) {
    return;
  }

  try {
    let preState = await regen.getPreState(firstBlock.message);
    for (const block of blocksInEpoch) {
      preState = await runStateTransition({emitter, forkChoice, metrics}, checkpointStateCache, preState, {
        reprocess: job.reprocess,
        prefinalized: job.prefinalized,
        signedBlock: block,
        // validate signatures in batch below
        validProposerSignature: true,
        validSignatures: true,
      });

      // Callback to count processed blocks in processChainSegment
      if (onProcessBlock) onProcessBlock(block);

      // this avoids keeping our node busy processing blocks
      await sleep(0);
    }

    // Verify signatures after running state transition, so all SyncCommittee signed roots are known at this point.
    // We must ensure block.slot <= state.slot before running getAllBlockSignatureSets().
    if (!opts?.disableBlsBatchVerify && !job.validSignatures) {
      const signatureSets: ISignatureSet[] = [];
      for (const block of blocksInEpoch) {
        signatureSets.push(
          ...(job.validProposerSignature
            ? allForks.getAllBlockSignatureSetsExceptProposer(preState, block)
            : allForks.getAllBlockSignatureSets(preState as CachedBeaconState<allForks.BeaconState>, block))
        );
      }

      if (signatureSets.length > 0 && !(await bls.verifySignatureSets(signatureSets))) {
        throw new BlockError(firstBlock, {code: BlockErrorCode.INVALID_SIGNATURE});
      }
    }
  } catch (e) {
    if (e instanceof RegenError) {
      throw new BlockError(firstBlock, {code: BlockErrorCode.PRESTATE_MISSING});
    }

    if (e instanceof BlockError) {
      throw e;
    }

    throw new BlockError(firstBlock, {code: BlockErrorCode.BEACON_CHAIN_ERROR, error: e as Error});
  }
}
