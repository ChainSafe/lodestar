// this will need async once we wan't to resolve archive slot
import {GENESIS_SLOT} from "@chainsafe/lodestar-beacon-state-transition";
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
import {IBeaconDb} from "../../../../db/api";
import {ApiStateContext, StateId} from "./interface";

export async function resolveStateId(
  config: IBeaconConfig,
  db: IBeaconDb,
  forkChoice: IForkChoice,
  stateId: StateId
): Promise<ApiStateContext | null> {
  stateId = stateId.toLowerCase();
  if (stateId === "head" || stateId === "genesis" || stateId === "finalized" || stateId === "justified") {
    return await stateByName(db, forkChoice, stateId);
  } else if (stateId.startsWith("0x")) {
    return await stateByRoot(db, stateId);
  } else {
    // state id must be slot
    const slot = parseInt(stateId, 10);
    if (isNaN(slot) && isNaN(slot - 0)) {
      throw new Error("Invalid state id");
    }
    return await stateBySlot(db, forkChoice, slot);
  }
}

export function toValidatorResponse(index: ValidatorIndex, validator: Validator, balance: Gwei): ValidatorResponse {
  return {
    index,
    status: ValidatorStatus.ACTIVE,
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

async function stateByName(db: IBeaconDb, forkChoice: IForkChoice, stateId: StateId): Promise<ApiStateContext | null> {
  let state: TreeBacked<BeaconState> | null = null;
  switch (stateId) {
    case "head":
      return (await db.stateCache.get(forkChoice.getHead().stateRoot)) ?? null;
    case "genesis":
      state = await db.stateArchive.get(GENESIS_SLOT);
      return state ? {state} : null;
    case "finalized":
      return (await db.stateCache.get(forkChoice.getFinalizedCheckpoint().root)) ?? null;
    case "justified":
      return (await db.stateCache.get(forkChoice.getJustifiedCheckpoint().root)) ?? null;
    default:
      throw new Error("not a named state id");
  }
}

async function stateByRoot(db: IBeaconDb, stateId: StateId): Promise<ApiStateContext | null> {
  if (stateId.startsWith("0x")) {
    const stateRoot = fromHexString(stateId);
    const cachedStateCtx = await db.stateCache.get(stateRoot);
    if (cachedStateCtx) return cachedStateCtx;
    const finalizedState = await db.stateArchive.getByRoot(stateRoot);
    return finalizedState ? {state: finalizedState} : null;
  } else {
    throw new Error("not a root state id");
  }
}

async function stateBySlot(db: IBeaconDb, forkChoice: IForkChoice, slot: Slot): Promise<ApiStateContext | null> {
  const blockSummary = forkChoice.getCanonicalBlockSummaryAtSlot(slot);
  if (blockSummary) {
    return (await db.stateCache.get(blockSummary.stateRoot)) ?? null;
  } else {
    const finalizedState = await db.stateArchive.get(slot);
    return finalizedState ? {state: finalizedState} : null;
  }
}
