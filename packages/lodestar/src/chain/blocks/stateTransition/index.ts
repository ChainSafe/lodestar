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
import {
  fastStateTransition,
  IStateContext,
  epochToCurrentForkVersion,
  computeEpochAtSlot,
  lightclient,
} from "@chainsafe/lodestar-beacon-state-transition";
import {emitCheckpointEvent, emitBlockEvent, emitForkChoiceHeadEvents} from "./events";
import {sleep, toHex} from "@chainsafe/lodestar-utils";
import {toTreeStateContext} from "./utils";
import {BeaconState, Lightclient, SignedBeaconBlock} from "@chainsafe/lodestar-types";

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

  const postStateContext = executeStateTransition(checkpointStateContext, job);

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

function executeStateTransition(
  stateCtx: ITreeStateContext<BeaconState | Lightclient.BeaconState>,
  job: IBlockJob<SignedBeaconBlock | Lightclient.SignedBeaconBlock>
): ITreeStateContext {
  let result: IStateContext;
  const config = stateCtx.epochCtx.config;
  const slot = job.signedBlock.message.slot;
  const fork = epochToCurrentForkVersion(config, computeEpochAtSlot(config, slot));
  if (!fork) {
    throw new Error(`Missing fork definition for slot ${slot}`);
  }
  switch (toHex(fork)) {
    case toHex(config.params.GENESIS_FORK_VERSION):
      {
        result = lightclient.fast.stateTransition(
          stateCtx as ITreeStateContext<Lightclient.BeaconState>,
          job.signedBlock as Lightclient.SignedBeaconBlock,
          {
            verifyStateRoot: true,
            verifyProposer: !job.validSignatures && !job.validProposerSignature,
            verifySignatures: !job.validSignatures,
          }
        );
      }
      break;
    case toHex(config.params.lightclient.LIGHTCLIENT_PATCH_FORK_VERSION):
      {
        result = fastStateTransition(stateCtx, job.signedBlock, {
          verifyStateRoot: true,
          verifyProposer: !job.validSignatures && !job.validProposerSignature,
          verifySignatures: !job.validSignatures,
        });
      }
      break;
    default:
      throw new Error("State transition doesn't support fork");
  }
  return toTreeStateContext(result);
}
