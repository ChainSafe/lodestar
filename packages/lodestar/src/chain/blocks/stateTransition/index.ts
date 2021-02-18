import {
  computeEpochAtSlot,
  epochToCurrentForkVersion,
  IStateContext,
  lightclient,
  phase0,
} from "@chainsafe/lodestar-beacon-state-transition";
import {IForkChoice} from "@chainsafe/lodestar-fork-choice";
import {Gwei, Lightclient} from "@chainsafe/lodestar-types";
import {sleep, toHex} from "@chainsafe/lodestar-utils";
import {ChainEventEmitter, IBlockJob, ITreeStateContext} from "../..";
import {CheckpointStateCache} from "../../stateCache";
import {emitBlockEvent, emitCheckpointEvent, emitForkChoiceHeadEvents} from "./events";

export * from "./events";
export * from "./utils";

export async function runStateTransition(
  emitter: ChainEventEmitter,
  forkChoice: IForkChoice,
  checkpointStateCache: CheckpointStateCache,
  stateContext: ITreeStateContext,
  job: IBlockJob
): Promise<ITreeStateContext> {
  const config = stateContext.epochCtx.config;
  const {SLOTS_PER_EPOCH} = config.params;
  const postSlot = job.signedBlock.message.slot;

  // if block is trusted don't verify proposer or op signature
  const postStateContext = executeStateTransition(stateContext, job);

  const oldHead = forkChoice.getHead();

  // current justified checkpoint should be prev epoch or current epoch if it's just updated
  // it should always have epochBalances there bc it's a checkpoint state, ie got through processEpoch
  const justifiedBalances: Gwei[] = [];
  if (postStateContext.state.currentJustifiedCheckpoint.epoch > forkChoice.getJustifiedCheckpoint().epoch) {
    const justifiedStateContext = checkpointStateCache.get(postStateContext.state.currentJustifiedCheckpoint);
    const justifiedEpoch = justifiedStateContext?.epochCtx.currentShuffling.epoch;
    justifiedStateContext?.state.flatValidators().readOnlyForEach((v) => {
      justifiedBalances.push(phase0.fast.isActiveIFlatValidator(v, justifiedEpoch!) ? v.effectiveBalance : BigInt(0));
    });
  }
  forkChoice.onBlock(job.signedBlock.message, postStateContext.state.getOriginalState(), justifiedBalances);

  if (postSlot % SLOTS_PER_EPOCH === 0) {
    emitCheckpointEvent(emitter, postStateContext);
  }

  emitBlockEvent(emitter, job, postStateContext);
  emitForkChoiceHeadEvents(emitter, forkChoice, forkChoice.getHead(), oldHead);

  // this avoids keeping our node busy processing blocks
  await sleep(0);
  return postStateContext;
}

function executeStateTransition(stateCtx: ITreeStateContext, job: IBlockJob): ITreeStateContext {
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
        result = phase0.fast.fastStateTransition(stateCtx, job.signedBlock, {
          verifyStateRoot: true,
          verifyProposer: !job.validSignatures && !job.validProposerSignature,
          verifySignatures: !job.validSignatures,
        });
      }
      break;
    case toHex(config.params.lightclient.LIGHTCLIENT_PATCH_FORK_VERSION):
      {
        result = lightclient.fast.stateTransition(stateCtx, job.signedBlock as Lightclient.SignedBeaconBlock, {
          verifyStateRoot: true,
          verifyProposer: !job.validSignatures && !job.validProposerSignature,
          verifySignatures: !job.validSignatures,
        });
      }
      break;
    default:
      throw new Error("State transition doesn't support fork");
  }
  return result;
}
