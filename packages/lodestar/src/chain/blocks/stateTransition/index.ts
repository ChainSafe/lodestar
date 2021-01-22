import {ChainEventEmitter, IBlockJob} from "../..";
import {IForkChoice} from "@chainsafe/lodestar-fork-choice";
import {ITreeStateContext} from "../../../db/api/beacon/stateContextCache";
import {IBeaconDb} from "../../../db";
import {processSlotsToNearestCheckpoint} from "./utils";
import {
  getAllBlockSignatureSetsExceptProposer,
  getAllBlockSignatureSets,
} from "@chainsafe/lodestar-beacon-state-transition/lib/fast/signatureSets";
import {verifySignatureSetsBatch} from "../../bls";
import {BlockError} from "../../errors";
import {BlockErrorCode} from "../../errors/blockError";
import {fastStateTransition} from "@chainsafe/lodestar-beacon-state-transition";
import {emitCheckpointEvent, emitBlockEvent, emitForkChoiceHeadEvents} from "./events";
import {sleep} from "@chainsafe/lodestar-utils";
import {toTreeStateContext} from "./utils";

export * from "./utils";
export * from "./events";

export async function runStateTransition(
  emitter: ChainEventEmitter,
  forkChoice: IForkChoice,
  db: IBeaconDb,
  stateContext: ITreeStateContext,
  job: IBlockJob
): Promise<ITreeStateContext> {
  const config = stateContext.epochCtx.config;
  const {SLOTS_PER_EPOCH} = config.params;
  const postSlot = job.signedBlock.message.slot;
  const checkpointStateContext = await processSlotsToNearestCheckpoint(emitter, stateContext, postSlot - 1);

  if (!job.validSignatures) {
    const {epochCtx, state} = checkpointStateContext;
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

  // if block is trusted don't verify proposer or op signature
  const postStateContext = toTreeStateContext(
    fastStateTransition(checkpointStateContext, job.signedBlock, {
      verifyStateRoot: true,
      verifyProposer: !job.validSignatures && !job.validProposerSignature,
      verifySignatures: !job.validSignatures,
    })
  );

  const oldHead = forkChoice.getHead();

  // current justified checkpoint should be prev epoch or current epoch if it's just updated
  // it should always have epochBalances there bc it's a checkpoint state, ie got through processEpoch
  const justifiedBalances = (await db.checkpointStateCache.get(postStateContext.state.currentJustifiedCheckpoint))
    ?.epochCtx.epochBalances;
  forkChoice.onBlock(job.signedBlock.message, postStateContext.state, justifiedBalances);

  if (postSlot % SLOTS_PER_EPOCH === 0) {
    emitCheckpointEvent(emitter, postStateContext);
  }

  emitBlockEvent(emitter, job, postStateContext);
  emitForkChoiceHeadEvents(emitter, forkChoice, forkChoice.getHead(), oldHead);

  // this avoids keeping our node busy processing blocks
  await sleep(0);
  return postStateContext;
}
