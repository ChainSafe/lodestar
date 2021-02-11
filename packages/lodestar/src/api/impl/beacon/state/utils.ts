// this will need async once we wan't to resolve archive slot
import {FAR_FUTURE_EPOCH, GENESIS_SLOT} from "@chainsafe/lodestar-beacon-state-transition";
import {computeEpochShuffling} from "@chainsafe/lodestar-beacon-state-transition/lib/fast/util";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IForkChoice} from "@chainsafe/lodestar-fork-choice";
import {
  Epoch,
  Validator,
  ValidatorIndex,
  ValidatorStatus,
  ValidatorResponse,
  Gwei,
  BeaconState,
  Slot,
} from "@chainsafe/lodestar-types";
import {fromHexString, readOnlyMap, TreeBacked} from "@chainsafe/ssz";
import {IBeaconChain} from "../../../../chain";
import {StateContextCache} from "../../../../chain/stateCache";
import {IBeaconDb} from "../../../../db/api";
import {ApiStateContext, StateId} from "./interface";

export async function resolveStateId(
  chain: IBeaconChain,
  db: IBeaconDb,
  stateId: StateId
): Promise<ApiStateContext | null> {
  stateId = stateId.toLowerCase();
  if (stateId === "head" || stateId === "genesis" || stateId === "finalized" || stateId === "justified") {
    return await stateByName(db, chain.stateCache, chain.forkChoice, stateId);
  } else if (stateId.startsWith("0x")) {
    return await stateByRoot(db, chain.stateCache, stateId);
  } else {
    // state id must be slot
    const slot = parseInt(stateId, 10);
    if (isNaN(slot) && isNaN(slot - 0)) {
      throw new Error("Invalid state id");
    }
    return await stateBySlot(db, chain.stateCache, chain.forkChoice, slot);
  }
}

/**
 * Get the status of the validator
 * based on conditions outlined in https://hackmd.io/ofFJ5gOmQpu1jjHilHbdQQ
 */
export function getValidatorStatus(validator: Validator, currentEpoch: Epoch): ValidatorStatus {
  // pending
  if (validator.activationEpoch > currentEpoch) {
    if (validator.activationEligibilityEpoch === FAR_FUTURE_EPOCH) {
      return ValidatorStatus.PENDING_INITIALIZED;
    } else if (validator.activationEligibilityEpoch < FAR_FUTURE_EPOCH) {
      return ValidatorStatus.PENDING_QUEUED;
    }
  }
  // active
  if (validator.activationEpoch <= currentEpoch && currentEpoch < validator.exitEpoch) {
    if (validator.exitEpoch === FAR_FUTURE_EPOCH) {
      return ValidatorStatus.ACTIVE_ONGOING;
    } else if (validator.exitEpoch < FAR_FUTURE_EPOCH) {
      return validator.slashed ? ValidatorStatus.ACTIVE_SLASHED : ValidatorStatus.ACTIVE_EXITING;
    }
  }
  // exited
  if (validator.exitEpoch <= currentEpoch && currentEpoch < validator.withdrawableEpoch) {
    return validator.slashed ? ValidatorStatus.EXITED_SLASHED : ValidatorStatus.EXITED_UNSLASHED;
  }
  // withdrawal
  if (validator.withdrawableEpoch <= currentEpoch) {
    return validator.effectiveBalance !== BigInt(0)
      ? ValidatorStatus.WITHDRAWAL_POSSIBLE
      : ValidatorStatus.WITHDRAWAL_DONE;
  }
  throw new Error("ValidatorStatus unknown");
}

export function toValidatorResponse(
  index: ValidatorIndex,
  validator: Validator,
  balance: Gwei,
  currentEpoch: Epoch
): ValidatorResponse {
  return {
    index,
    status: getValidatorStatus(validator, currentEpoch),
    balance,
    validator,
  };
}

/**
 * Returns committees mapped by index -> slot -> validator index
 */
export function getEpochBeaconCommittees(
  config: IBeaconConfig,
  chain: IBeaconChain,
  stateContext: ApiStateContext,
  epoch: Epoch
): ValidatorIndex[][][] {
  let committees: ValidatorIndex[][][] | null = null;
  if (stateContext.epochCtx) {
    switch (epoch) {
      case chain.clock.currentEpoch: {
        committees = stateContext.epochCtx.currentShuffling.committees;
        break;
      }
      case chain.clock.currentEpoch - 1: {
        committees = stateContext.epochCtx.previousShuffling.committees;
        break;
      }
    }
  }
  if (!committees) {
    const indicesBounded: [ValidatorIndex, Epoch, Epoch][] = readOnlyMap(stateContext.state.validators, (v, i) => [
      i,
      v.activationEpoch,
      v.exitEpoch,
    ]);

    const shuffling = computeEpochShuffling(config, stateContext.state, indicesBounded, epoch);
    committees = shuffling.committees;
  }
  return committees;
}

async function stateByName(
  db: IBeaconDb,
  stateCache: StateContextCache,
  forkChoice: IForkChoice,
  stateId: StateId
): Promise<ApiStateContext | null> {
  let state: TreeBacked<BeaconState> | null = null;
  switch (stateId) {
    case "head":
      return stateCache.get(forkChoice.getHead().stateRoot) ?? null;
    case "genesis":
      state = await db.stateArchive.get(GENESIS_SLOT);
      return state ? {state} : null;
    case "finalized":
      return stateCache.get(forkChoice.getFinalizedCheckpoint().root) ?? null;
    case "justified":
      return stateCache.get(forkChoice.getJustifiedCheckpoint().root) ?? null;
    default:
      throw new Error("not a named state id");
  }
}

async function stateByRoot(
  db: IBeaconDb,
  stateCache: StateContextCache,
  stateId: StateId
): Promise<ApiStateContext | null> {
  if (stateId.startsWith("0x")) {
    const stateRoot = fromHexString(stateId);
    const cachedStateCtx = stateCache.get(stateRoot);
    if (cachedStateCtx) return cachedStateCtx;
    const finalizedState = await db.stateArchive.getByRoot(stateRoot);
    return finalizedState ? {state: finalizedState} : null;
  } else {
    throw new Error("not a root state id");
  }
}

async function stateBySlot(
  db: IBeaconDb,
  stateCache: StateContextCache,
  forkChoice: IForkChoice,
  slot: Slot
): Promise<ApiStateContext | null> {
  const blockSummary = forkChoice.getCanonicalBlockSummaryAtSlot(slot);
  if (blockSummary) {
    return stateCache.get(blockSummary.stateRoot) ?? null;
  } else {
    const finalizedState = await db.stateArchive.get(slot);
    return finalizedState ? {state: finalizedState} : null;
  }
}
