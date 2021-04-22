// this will need async once we wan't to resolve archive slot
import {
  GENESIS_SLOT,
  FAR_FUTURE_EPOCH,
  CachedBeaconState,
  createCachedBeaconState,
} from "@chainsafe/lodestar-beacon-state-transition";
import {allForks, phase0} from "@chainsafe/lodestar-types";
import {phase0 as beaconStateTransitionPhase0} from "@chainsafe/lodestar-beacon-state-transition";
import {fast} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IForkChoice} from "@chainsafe/lodestar-fork-choice";
import {Epoch, ValidatorIndex, Gwei, Slot} from "@chainsafe/lodestar-types";
import {ValidatorResponse} from "@chainsafe/lodestar-types/phase0";
import {fromHexString, readonlyValues, TreeBacked} from "@chainsafe/ssz";
import {IBeaconChain} from "../../../../chain";
import {StateContextCache} from "../../../../chain/stateCache";
import {IBeaconDb} from "../../../../db";
import {getStateValidatorIndex} from "../../utils";
import {ApiError, ValidationError} from "../../errors";
import {StateId} from "./interface";
import {sleep, assert} from "@chainsafe/lodestar-utils";

type ResolveStateIdOpts = {
  /**
   * triggers a fetch of the nearest finalized state from the archive if the state at the desired
   * stateId is not in the archive and run the state transition up to the desired slot
   * NOTE: this is not related to chain.regen, which handles regenerating un-finalized states
   */
  regenFinalizedState?: boolean;
};

export async function resolveStateId(
  config: IBeaconConfig,
  chain: IBeaconChain,
  db: IBeaconDb,
  stateId: StateId,
  opts?: ResolveStateIdOpts
): Promise<allForks.BeaconState> {
  const state = await resolveStateIdOrNull(config, chain, db, stateId, opts);
  if (!state) {
    throw new ApiError(404, `No state found for id '${stateId}'`);
  }

  return state;
}

async function resolveStateIdOrNull(
  config: IBeaconConfig,
  chain: IBeaconChain,
  db: IBeaconDb,
  stateId: StateId,
  opts?: ResolveStateIdOpts
): Promise<allForks.BeaconState | null> {
  stateId = stateId.toLowerCase();
  if (stateId === "head" || stateId === "genesis" || stateId === "finalized" || stateId === "justified") {
    return await stateByName(db, chain.stateCache, chain.forkChoice, stateId);
  }

  if (stateId.startsWith("0x")) {
    return await stateByRoot(db, chain.stateCache, stateId);
  }

  // state id must be slot
  const slot = parseInt(stateId, 10);
  if (isNaN(slot) && isNaN(slot - 0)) {
    throw new ValidationError(`Invalid state id '${stateId}'`, "stateId");
  }
  return await stateBySlot(config, db, chain.stateCache, chain.forkChoice, slot, opts);
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
  state: allForks.BeaconState | CachedBeaconState<allForks.BeaconState>,
  epoch: Epoch
): ValidatorIndex[][][] {
  let committees: ValidatorIndex[][][] | null = null;
  if ((state as CachedBeaconState<allForks.BeaconState>).epochCtx) {
    switch (epoch) {
      case chain.clock.currentEpoch: {
        committees = (state as CachedBeaconState<allForks.BeaconState>).currentShuffling.committees;
        break;
      }
      case chain.clock.currentEpoch - 1: {
        committees = (state as CachedBeaconState<allForks.BeaconState>).previousShuffling.committees;
        break;
      }
    }
  }
  if (!committees) {
    const indicesBounded: [ValidatorIndex, Epoch, Epoch][] = Array.from(readonlyValues(state.validators), (v, i) => [
      i,
      v.activationEpoch,
      v.exitEpoch,
    ]);

    const shuffling = fast.computeEpochShuffling(config, state, indicesBounded, epoch);
    committees = shuffling.committees;
  }
  return committees;
}

async function stateByName(
  db: IBeaconDb,
  stateCache: StateContextCache,
  forkChoice: IForkChoice,
  stateId: StateId
): Promise<allForks.BeaconState | null> {
  switch (stateId) {
    case "head":
      return stateCache.get(forkChoice.getHead().stateRoot) ?? null;
    case "genesis":
      return await db.stateArchive.get(GENESIS_SLOT);
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
): Promise<allForks.BeaconState | null> {
  if (stateId.startsWith("0x")) {
    const stateRoot = fromHexString(stateId);
    const cachedStateCtx = stateCache.get(stateRoot);
    if (cachedStateCtx) return cachedStateCtx;
    return await db.stateArchive.getByRoot(stateRoot);
  } else {
    throw new Error("not a root state id");
  }
}

async function stateBySlot(
  config: IBeaconConfig,
  db: IBeaconDb,
  stateCache: StateContextCache,
  forkChoice: IForkChoice,
  slot: Slot,
  opts?: ResolveStateIdOpts
): Promise<allForks.BeaconState | null> {
  const blockSummary = forkChoice.getCanonicalBlockSummaryAtSlot(slot);
  if (blockSummary) {
    return stateCache.get(blockSummary.stateRoot) ?? null;
  } else {
    if (opts?.regenFinalizedState) {
      return await getFinalizedState(config, db, forkChoice, slot);
    }
    return await db.stateArchive.get(slot);
  }
}

export function filterStateValidatorsByStatuses(
  statuses: string[],
  state: allForks.BeaconState,
  chain: IBeaconChain,
  currentEpoch: Epoch
): ValidatorResponse[] {
  const responses: ValidatorResponse[] = [];
  const validators = Array.from(state.validators);
  const filteredValidators = validators.filter((v) => statuses.includes(getValidatorStatus(v, currentEpoch)));
  for (const validator of readonlyValues(filteredValidators)) {
    const validatorIndex = getStateValidatorIndex(validator.pubkey, state, chain);
    if (validatorIndex && statuses?.includes(getValidatorStatus(validator, currentEpoch))) {
      responses.push(toValidatorResponse(validatorIndex, validator, state.balances[validatorIndex], currentEpoch));
    }
  }
  return responses;
}

/**
 * Get the archived state nearest to `slot`.
 */
async function getNearestArchivedState(
  config: IBeaconConfig,
  db: IBeaconDb,
  slot: Slot
): Promise<CachedBeaconState<allForks.BeaconState>> {
  const states = db.stateArchive.valuesStream({lte: slot, reverse: true});
  const state = (await states[Symbol.asyncIterator]().next()).value as TreeBacked<allForks.BeaconState>;
  return createCachedBeaconState(config, state);
}

async function getFinalizedState(
  config: IBeaconConfig,
  db: IBeaconDb,
  forkChoice: IForkChoice,
  slot: Slot
): Promise<CachedBeaconState<allForks.BeaconState>> {
  assert.lte(slot, forkChoice.getFinalizedCheckpoint().epoch * config.params.SLOTS_PER_EPOCH);
  let state = await getNearestArchivedState(config, db, slot);

  // process blocks up to the requested slot
  for await (const block of db.blockArchive.valuesStream({gt: state.slot, lte: slot})) {
    state = fast.fastStateTransition(state, block, {
      verifyStateRoot: false,
      verifyProposer: false,
      verifySignatures: false,
    });
    // yield to the event loop
    await sleep(0);
  }
  // due to skip slots, may need to process empty slots to reach the requested slot
  if (state.slot < slot) {
    beaconStateTransitionPhase0.fast.processSlots(state as CachedBeaconState<phase0.BeaconState>, slot);
  }
  return state;
}
