import {routes} from "@chainsafe/lodestar-api";
import {FAR_FUTURE_EPOCH, GENESIS_SLOT, SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";
// this will need async once we wan't to resolve archive slot
import {
  CachedBeaconStateAllForks,
  createCachedBeaconState,
  PubkeyIndexMap,
} from "@chainsafe/lodestar-beacon-state-transition";
import {phase0} from "@chainsafe/lodestar-types";
import {allForks} from "@chainsafe/lodestar-beacon-state-transition";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {IForkChoice} from "@chainsafe/lodestar-fork-choice";
import {Epoch, ValidatorIndex, Slot} from "@chainsafe/lodestar-types";
import {ByteVector, fromHexString, readonlyValues, TreeBacked} from "@chainsafe/ssz";
import {IBeaconChain} from "../../../../chain";
import {StateContextCache} from "../../../../chain/stateCache";
import {IBeaconDb} from "../../../../db";
import {ApiError, ValidationError} from "../../errors";
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
  config: IChainForkConfig,
  chain: IBeaconChain,
  db: IBeaconDb,
  stateId: routes.beacon.StateId,
  opts?: ResolveStateIdOpts
): Promise<allForks.BeaconState> {
  const state = await resolveStateIdOrNull(config, chain, db, stateId, opts);
  if (!state) {
    throw new ApiError(404, `No state found for id '${stateId}'`);
  }

  return state;
}

async function resolveStateIdOrNull(
  config: IChainForkConfig,
  chain: IBeaconChain,
  db: IBeaconDb,
  stateId: routes.beacon.StateId,
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
export function getValidatorStatus(validator: phase0.Validator, currentEpoch: Epoch): routes.beacon.ValidatorStatus {
  // pending
  if (validator.activationEpoch > currentEpoch) {
    if (validator.activationEligibilityEpoch === FAR_FUTURE_EPOCH) {
      return "pending_initialized";
    } else if (validator.activationEligibilityEpoch < FAR_FUTURE_EPOCH) {
      return "pending_queued";
    }
  }
  // active
  if (validator.activationEpoch <= currentEpoch && currentEpoch < validator.exitEpoch) {
    if (validator.exitEpoch === FAR_FUTURE_EPOCH) {
      return "active_ongoing";
    } else if (validator.exitEpoch < FAR_FUTURE_EPOCH) {
      return validator.slashed ? "active_slashed" : "active_exiting";
    }
  }
  // exited
  if (validator.exitEpoch <= currentEpoch && currentEpoch < validator.withdrawableEpoch) {
    return validator.slashed ? "exited_slashed" : "exited_unslashed";
  }
  // withdrawal
  if (validator.withdrawableEpoch <= currentEpoch) {
    return validator.effectiveBalance !== 0 ? "withdrawal_possible" : "withdrawal_done";
  }
  throw new Error("ValidatorStatus unknown");
}

export function toValidatorResponse(
  index: ValidatorIndex,
  validator: phase0.Validator,
  balance: number,
  currentEpoch: Epoch
): routes.beacon.ValidatorResponse {
  return {
    index,
    status: getValidatorStatus(validator, currentEpoch),
    balance,
    validator,
  };
}

async function stateByName(
  db: IBeaconDb,
  stateCache: StateContextCache,
  forkChoice: IForkChoice,
  stateId: routes.beacon.StateId
): Promise<allForks.BeaconState | null> {
  switch (stateId) {
    case "head":
      return stateCache.get(forkChoice.getHead().stateRoot) ?? null;
    case "genesis":
      return await db.stateArchive.get(GENESIS_SLOT);
    case "finalized":
      return stateCache.get(forkChoice.getFinalizedBlock().stateRoot) ?? null;
    case "justified":
      return stateCache.get(forkChoice.getJustifiedBlock().stateRoot) ?? null;
    default:
      throw new Error("not a named state id");
  }
}

async function stateByRoot(
  db: IBeaconDb,
  stateCache: StateContextCache,
  stateId: routes.beacon.StateId
): Promise<allForks.BeaconState | null> {
  if (stateId.startsWith("0x")) {
    const stateRoot = stateId;
    const cachedStateCtx = stateCache.get(stateRoot);
    if (cachedStateCtx) return cachedStateCtx;
    return await db.stateArchive.getByRoot(fromHexString(stateRoot));
  } else {
    throw new Error("not a root state id");
  }
}

async function stateBySlot(
  config: IChainForkConfig,
  db: IBeaconDb,
  stateCache: StateContextCache,
  forkChoice: IForkChoice,
  slot: Slot,
  opts?: ResolveStateIdOpts
): Promise<allForks.BeaconState | null> {
  const blockSummary = forkChoice.getCanonicalBlockAtSlot(slot);
  if (blockSummary) {
    const state = stateCache.get(blockSummary.stateRoot);
    if (state) {
      return state;
    }
  }

  if (opts?.regenFinalizedState) {
    return await getFinalizedState(config, db, forkChoice, slot);
  }

  return await db.stateArchive.get(slot);
}

export function filterStateValidatorsByStatuses(
  statuses: string[],
  state: allForks.BeaconState,
  pubkey2index: PubkeyIndexMap,
  currentEpoch: Epoch
): routes.beacon.ValidatorResponse[] {
  const responses: routes.beacon.ValidatorResponse[] = [];
  const validators = Array.from(state.validators);
  const filteredValidators = validators.filter((v) => statuses.includes(getValidatorStatus(v, currentEpoch)));
  for (const validator of readonlyValues(filteredValidators)) {
    const validatorIndex = getStateValidatorIndex(validator.pubkey, state, pubkey2index);
    if (validatorIndex !== undefined && statuses?.includes(getValidatorStatus(validator, currentEpoch))) {
      responses.push(toValidatorResponse(validatorIndex, validator, state.balances[validatorIndex], currentEpoch));
    }
  }
  return responses;
}

/**
 * Get the archived state nearest to `slot`.
 */
async function getNearestArchivedState(
  config: IChainForkConfig,
  db: IBeaconDb,
  slot: Slot
): Promise<CachedBeaconStateAllForks> {
  const states = db.stateArchive.valuesStream({lte: slot, reverse: true});
  const state = (await states[Symbol.asyncIterator]().next()).value as TreeBacked<allForks.BeaconState>;
  return createCachedBeaconState(config, state);
}

async function getFinalizedState(
  config: IChainForkConfig,
  db: IBeaconDb,
  forkChoice: IForkChoice,
  slot: Slot
): Promise<CachedBeaconStateAllForks> {
  assert.lte(slot, forkChoice.getFinalizedCheckpoint().epoch * SLOTS_PER_EPOCH);
  let state = await getNearestArchivedState(config, db, slot);

  // process blocks up to the requested slot
  for await (const block of db.blockArchive.valuesStream({gt: state.slot, lte: slot})) {
    state = allForks.stateTransition(state, block, {
      verifyStateRoot: false,
      verifyProposer: false,
      verifySignatures: false,
    });
    // yield to the event loop
    await sleep(0);
  }
  // due to skip slots, may need to process empty slots to reach the requested slot
  if (state.slot < slot) {
    state = allForks.processSlots(state, slot);
  }
  return state;
}

export function getStateValidatorIndex(
  id: routes.beacon.ValidatorId | ByteVector,
  state: allForks.BeaconState,
  pubkey2index: PubkeyIndexMap
): number | undefined {
  let validatorIndex: ValidatorIndex | undefined;
  if (typeof id === "number") {
    if (state.validators.length > id) {
      validatorIndex = id;
    }
  } else {
    validatorIndex = pubkey2index.get(id) ?? undefined;
    // validator added later than given stateId
    if (validatorIndex !== undefined && validatorIndex >= state.validators.length) {
      validatorIndex = undefined;
    }
  }
  return validatorIndex;
}
