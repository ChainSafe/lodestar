// this will need async once we wan't to resolve archive slot
import {GENESIS_SLOT} from "@chainsafe/lodestar-beacon-state-transition";
import {CachedBeaconState} from "@chainsafe/lodestar-beacon-state-transition/lib/fast/util";
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
  Slot,
} from "@chainsafe/lodestar-types";
import {fromHexString, readOnlyMap} from "@chainsafe/ssz";
import {IBeaconDb} from "../../../../db/api";
import {ApiState, StateId} from "./interface";

export async function resolveStateId(
  db: IBeaconDb,
  forkChoice: IForkChoice,
  stateId: StateId
): Promise<ApiState | null> {
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
export function getEpochBeaconCommittees(config: IBeaconConfig, state: ApiState, epoch: Epoch): ValidatorIndex[][][] {
  let committees: ValidatorIndex[][][] | null = null;
  const cachedState = state as CachedBeaconState;
  // it's a CachedBeaconState which has EpochContext inside
  if (cachedState.config) {
    switch (epoch) {
      case cachedState.currentShuffling.epoch: {
        committees = cachedState.currentShuffling.committees;
        break;
      }
      case cachedState.previousShuffling.epoch: {
        committees = cachedState.previousShuffling.committees;
        break;
      }
      case cachedState.nextShuffling.epoch: {
        committees = cachedState.nextShuffling.committees;
        break;
      }
    }
  }
  if (!committees) {
    const indicesBounded: [ValidatorIndex, Epoch, Epoch][] = readOnlyMap(state.validators, (v, i) => [
      i,
      v.activationEpoch,
      v.exitEpoch,
    ]);

    const shuffling = computeEpochShuffling(config, state, indicesBounded, epoch);
    committees = shuffling.committees;
  }
  return committees;
}

async function stateByName(db: IBeaconDb, forkChoice: IForkChoice, stateId: StateId): Promise<ApiState | null> {
  switch (stateId) {
    case "head":
      return (await db.stateCache.get(forkChoice.getHead().stateRoot)) ?? null;
    case "genesis":
      return db.stateArchive.get(GENESIS_SLOT);
    case "finalized":
      return (await db.stateCache.get(forkChoice.getFinalizedCheckpoint().root)) ?? null;
    case "justified":
      return (await db.stateCache.get(forkChoice.getJustifiedCheckpoint().root)) ?? null;
    default:
      throw new Error("not a named state id");
  }
}

async function stateByRoot(db: IBeaconDb, stateId: StateId): Promise<ApiState | null> {
  if (stateId.startsWith("0x")) {
    const stateRoot = fromHexString(stateId);
    const cachedStateCtx = await db.stateCache.get(stateRoot);
    if (cachedStateCtx) return cachedStateCtx;
    return db.stateArchive.getByRoot(stateRoot);
  } else {
    throw new Error("not a root state id");
  }
}

async function stateBySlot(db: IBeaconDb, forkChoice: IForkChoice, slot: Slot): Promise<ApiState | null> {
  const blockSummary = forkChoice.getCanonicalBlockSummaryAtSlot(slot);
  if (blockSummary) {
    return db.stateCache.get(blockSummary.stateRoot);
  } else {
    // TODO: regen archived state?
    return db.stateArchive.get(slot);
  }
}
