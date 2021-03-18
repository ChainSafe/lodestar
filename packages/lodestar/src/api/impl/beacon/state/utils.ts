// this will need async once we wan't to resolve archive slot
import {GENESIS_SLOT, FAR_FUTURE_EPOCH, CachedBeaconState} from "@chainsafe/lodestar-beacon-state-transition";
import {phase0} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Epoch, ValidatorIndex, Gwei, Slot, Root} from "@chainsafe/lodestar-types";
import {fromHexString, readOnlyMap} from "@chainsafe/ssz";
import {IBeaconChain} from "../../../../chain";
import {IBeaconDb} from "../../../../db/api";
import {StateId} from "./interface";

export enum RegenType {
  CacheOnly,
  AllowRegen,
}

export async function resolveStateId(
  chain: IBeaconChain,
  db: IBeaconDb,
  stateId: StateId,
  type: RegenType = RegenType.CacheOnly
): Promise<phase0.BeaconState | null> {
  stateId = stateId.toLowerCase();
  if (stateId === "head" || stateId === "genesis" || stateId === "finalized" || stateId === "justified") {
    return await stateByName(db, chain, stateId, type);
  } else if (stateId.startsWith("0x")) {
    return await stateByRoot(db, chain, fromHexString(stateId), type);
  } else {
    // state id must be slot
    const slot = parseInt(stateId, 10);
    if (isNaN(slot) && isNaN(slot - 0)) {
      throw new Error("Invalid state id");
    }
    return await stateBySlot(db, chain, slot, type);
  }
}

/**
 * Get the status of the validator
 * based on conditions outlined in https://hackmd.io/ofFJ5gOmQpu1jjHilHbdQQ
 */
export function getValidatorStatus(validator: phase0.Validator, currentEpoch: Epoch): phase0.ValidatorStatus {
  // pending
  if (validator.activationEpoch > currentEpoch) {
    if (validator.activationEligibilityEpoch === FAR_FUTURE_EPOCH) {
      return phase0.ValidatorStatus.PENDING_INITIALIZED;
    } else if (validator.activationEligibilityEpoch < FAR_FUTURE_EPOCH) {
      return phase0.ValidatorStatus.PENDING_QUEUED;
    }
  }
  // active
  if (validator.activationEpoch <= currentEpoch && currentEpoch < validator.exitEpoch) {
    if (validator.exitEpoch === FAR_FUTURE_EPOCH) {
      return phase0.ValidatorStatus.ACTIVE_ONGOING;
    } else if (validator.exitEpoch < FAR_FUTURE_EPOCH) {
      return validator.slashed ? phase0.ValidatorStatus.ACTIVE_SLASHED : phase0.ValidatorStatus.ACTIVE_EXITING;
    }
  }
  // exited
  if (validator.exitEpoch <= currentEpoch && currentEpoch < validator.withdrawableEpoch) {
    return validator.slashed ? phase0.ValidatorStatus.EXITED_SLASHED : phase0.ValidatorStatus.EXITED_UNSLASHED;
  }
  // withdrawal
  if (validator.withdrawableEpoch <= currentEpoch) {
    return validator.effectiveBalance !== BigInt(0)
      ? phase0.ValidatorStatus.WITHDRAWAL_POSSIBLE
      : phase0.ValidatorStatus.WITHDRAWAL_DONE;
  }
  throw new Error("ValidatorStatus unknown");
}

export function toValidatorResponse(
  index: ValidatorIndex,
  validator: phase0.Validator,
  balance: Gwei,
  currentEpoch: Epoch
): phase0.ValidatorResponse {
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
  state: phase0.BeaconState | CachedBeaconState<phase0.BeaconState>,
  epoch: Epoch
): ValidatorIndex[][][] {
  let committees: ValidatorIndex[][][] | null = null;
  if ((state as CachedBeaconState<phase0.BeaconState>).epochCtx) {
    switch (epoch) {
      case chain.clock.currentEpoch: {
        committees = (state as CachedBeaconState<phase0.BeaconState>).currentShuffling.committees;
        break;
      }
      case chain.clock.currentEpoch - 1: {
        committees = (state as CachedBeaconState<phase0.BeaconState>).previousShuffling.committees;
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

    const shuffling = phase0.fast.computeEpochShuffling(config, state, indicesBounded, epoch);
    committees = shuffling.committees;
  }
  return committees;
}

async function stateByName(
  db: IBeaconDb,
  chain: IBeaconChain,
  stateId: StateId,
  type: RegenType
): Promise<phase0.BeaconState | null> {
  switch (stateId) {
    case "head":
      return await stateByRoot(db, chain, chain.forkChoice.getHead().stateRoot, type);
    case "genesis":
      return await db.stateArchive.get(GENESIS_SLOT);
    case "finalized":
      return await stateByRoot(db, chain, chain.forkChoice.getFinalizedCheckpoint().root, type);
    case "justified":
      return await stateByRoot(db, chain, chain.forkChoice.getJustifiedCheckpoint().root, type);
    default:
      throw new Error("not a named state id");
  }
}

async function stateByRoot(
  db: IBeaconDb,
  chain: IBeaconChain,
  stateRoot: Root,
  type: RegenType
): Promise<phase0.BeaconState | null> {
  if (type === RegenType.AllowRegen) {
    return await chain.regen.getState(stateRoot);
  } else {
    const cachedStateCtx = chain.stateCache.get(stateRoot);
    if (cachedStateCtx) return cachedStateCtx;
    return await db.stateArchive.getByRoot(stateRoot);
  }
}

async function stateBySlot(
  db: IBeaconDb,
  chain: IBeaconChain,
  slot: Slot,
  type: RegenType
): Promise<phase0.BeaconState | null> {
  const blockSummary = chain.forkChoice.getCanonicalBlockSummaryAtSlot(slot);
  if (type === RegenType.AllowRegen) {
    let stateRoot: Root;
    if (blockSummary) {
      stateRoot = blockSummary.stateRoot;
    } else {
      const block = await db.blockArchive.get(slot);
      if (!block) return null;
      stateRoot = block.message.stateRoot;
    }
    return await chain.regen.getState(stateRoot);
  } else {
    if (blockSummary) {
      return chain.stateCache.get(blockSummary.stateRoot) ?? null;
    } else {
      return await db.stateArchive.get(slot);
    }
  }
}
