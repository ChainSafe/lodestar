import {routes} from "@lodestar/api";
import {FAR_FUTURE_EPOCH, GENESIS_SLOT, SLOTS_PER_EPOCH} from "@lodestar/params";
// this will need async once we wan't to resolve archive slot
import {
  CachedBeaconStateAllForks,
  BeaconStateAllForks,
  createCachedBeaconState,
  createEmptyEpochContextImmutableData,
  PubkeyIndexMap,
  ExecutionPayloadStatus,
  DataAvailableStatus,
} from "@lodestar/state-transition";
import {BLSPubkey, phase0} from "@lodestar/types";
import {stateTransition, processSlots} from "@lodestar/state-transition";
import {ChainForkConfig} from "@lodestar/config";
import {IForkChoice} from "@lodestar/fork-choice";
import {Epoch, ValidatorIndex, Slot} from "@lodestar/types";
import {fromHexString} from "@chainsafe/ssz";
import {sleep, assert} from "@lodestar/utils";
import {IBeaconChain} from "../../../../chain/index.js";
import {StateContextCache} from "../../../../chain/stateCache/index.js";
import {IBeaconDb} from "../../../../db/index.js";
import {ApiError, ValidationError} from "../../errors.js";
import {isOptimisticBlock} from "../../../../util/forkChoice.js";

type ResolveStateIdOpts = {
  /**
   * triggers a fetch of the nearest finalized state from the archive if the state at the desired
   * stateId is not in the archive and run the state transition up to the desired slot
   * NOTE: this is not related to chain.regen, which handles regenerating un-finalized states
   */
  regenFinalizedState?: boolean;
};

export async function resolveStateId(
  config: ChainForkConfig,
  chain: IBeaconChain,
  db: IBeaconDb,
  stateId: routes.beacon.StateId,
  opts?: ResolveStateIdOpts
): Promise<{state: BeaconStateAllForks; executionOptimistic: boolean}> {
  const {state, executionOptimistic} = await resolveStateIdOrNull(config, chain, db, stateId, opts);
  if (!state) {
    throw new ApiError(404, `No state found for id '${stateId}'`);
  }

  return {state, executionOptimistic};
}

async function resolveStateIdOrNull(
  config: ChainForkConfig,
  chain: IBeaconChain,
  db: IBeaconDb,
  stateId: routes.beacon.StateId,
  opts?: ResolveStateIdOpts
): Promise<{state: BeaconStateAllForks | null; executionOptimistic: boolean}> {
  stateId = String(stateId).toLowerCase();
  if (stateId === "head" || stateId === "genesis" || stateId === "finalized" || stateId === "justified") {
    return stateByName(db, chain.stateCache, chain.forkChoice, stateId);
  }

  if (stateId.startsWith("0x")) {
    return stateByRoot(db, chain.stateCache, chain.forkChoice, stateId);
  }

  // state id must be slot
  const slot = parseInt(stateId, 10);
  if (isNaN(slot) && isNaN(slot - 0)) {
    throw new ValidationError(`Invalid state id '${stateId}'`, "stateId");
  }
  return stateBySlot(config, db, chain.stateCache, chain.forkChoice, slot, opts);
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
): Promise<{state: BeaconStateAllForks | null; executionOptimistic: boolean}> {
  switch (stateId) {
    case "head": {
      const head = forkChoice.getHead();
      const state = stateCache.get(head.stateRoot) ?? null;
      if (state) {
        return {state, executionOptimistic: isOptimisticBlock(head)};
      }
      return {state: null, executionOptimistic: false};
    }
    case "genesis":
      return {
        state: await db.stateArchive.get(GENESIS_SLOT),
        executionOptimistic: false,
      };
    case "finalized": {
      const state = stateCache.get(forkChoice.getFinalizedBlock().stateRoot) ?? null;
      return {
        state,
        executionOptimistic: false,
      };
    }
    case "justified": {
      const justifiedBlock = forkChoice.getJustifiedBlock();
      const state = stateCache.get(justifiedBlock.stateRoot) ?? null;
      return state
        ? {state, executionOptimistic: isOptimisticBlock(justifiedBlock)}
        : {state: null, executionOptimistic: false};
    }
    default:
      throw new Error("not a named state id");
  }
}

async function stateByRoot(
  db: IBeaconDb,
  stateCache: StateContextCache,
  forkChoice: IForkChoice,
  stateId: routes.beacon.StateId
): Promise<{state: BeaconStateAllForks | null; executionOptimistic: boolean}> {
  if (typeof stateId === "string" && stateId.startsWith("0x")) {
    const stateRoot = stateId;
    const cachedStateCtx = stateCache.get(stateRoot);
    if (cachedStateCtx) {
      const blockRoot = cachedStateCtx.latestBlockHeader.hashTreeRoot();
      const block = forkChoice.getBlock(blockRoot);
      return {state: cachedStateCtx, executionOptimistic: block != null && isOptimisticBlock(block)};
    }
    return {
      state: await db.stateArchive.getByRoot(fromHexString(stateRoot)),
      executionOptimistic: false,
    };
  } else {
    throw new Error("not a root state id");
  }
}

async function stateBySlot(
  config: ChainForkConfig,
  db: IBeaconDb,
  stateCache: StateContextCache,
  forkChoice: IForkChoice,
  slot: Slot,
  opts?: ResolveStateIdOpts
): Promise<{state: BeaconStateAllForks | null; executionOptimistic: boolean}> {
  const blockSummary = forkChoice.getCanonicalBlockAtSlot(slot);
  if (blockSummary) {
    const state = stateCache.get(blockSummary.stateRoot);
    if (state) {
      return {state, executionOptimistic: isOptimisticBlock(blockSummary)};
    }
  }

  if (opts?.regenFinalizedState) {
    return {state: await getFinalizedState(config, db, forkChoice, slot), executionOptimistic: false};
  }

  return {state: await db.stateArchive.get(slot), executionOptimistic: false};
}

export function filterStateValidatorsByStatus(
  statuses: string[],
  state: BeaconStateAllForks,
  pubkey2index: PubkeyIndexMap,
  currentEpoch: Epoch
): routes.beacon.ValidatorResponse[] {
  const responses: routes.beacon.ValidatorResponse[] = [];
  const validatorsArr = state.validators.getAllReadonlyValues();
  const statusSet = new Set(statuses);

  for (const validator of validatorsArr) {
    const validatorStatus = getValidatorStatus(validator, currentEpoch);

    const resp = getStateValidatorIndex(validator.pubkey, state, pubkey2index);
    if (resp.valid && statusSet.has(validatorStatus)) {
      responses.push(
        toValidatorResponse(resp.validatorIndex, validator, state.balances.get(resp.validatorIndex), currentEpoch)
      );
    }
  }
  return responses;
}

/**
 * Get the archived state nearest to `slot`.
 */
async function getNearestArchivedState(
  config: ChainForkConfig,
  db: IBeaconDb,
  slot: Slot
): Promise<CachedBeaconStateAllForks> {
  const states = db.stateArchive.valuesStream({lte: slot, reverse: true});
  const state = (await states[Symbol.asyncIterator]().next()).value as BeaconStateAllForks;
  // TODO - PENDING: Don't create new immutable caches here
  // see https://github.com/ChainSafe/lodestar/issues/3683
  return createCachedBeaconState(state, createEmptyEpochContextImmutableData(config, state));
}

async function getFinalizedState(
  config: ChainForkConfig,
  db: IBeaconDb,
  forkChoice: IForkChoice,
  slot: Slot
): Promise<CachedBeaconStateAllForks> {
  assert.lte(slot, forkChoice.getFinalizedCheckpoint().epoch * SLOTS_PER_EPOCH);
  let state = await getNearestArchivedState(config, db, slot);

  // process blocks up to the requested slot
  for await (const block of db.blockArchive.valuesStream({gt: state.slot, lte: slot})) {
    state = stateTransition(state, block, {
      // Replaying finalized blocks, all data is considered valid
      executionPayloadStatus: ExecutionPayloadStatus.valid,
      dataAvailableStatus: DataAvailableStatus.available,
      verifyStateRoot: false,
      verifyProposer: false,
      verifySignatures: false,
    });
    // yield to the event loop
    await sleep(0);
  }
  // due to skip slots, may need to process empty slots to reach the requested slot
  if (state.slot < slot) {
    state = processSlots(state, slot);
  }
  return state;
}

type StateValidatorIndexResponse = {valid: true; validatorIndex: number} | {valid: false; code: number; reason: string};

export function getStateValidatorIndex(
  id: routes.beacon.ValidatorId | BLSPubkey,
  state: BeaconStateAllForks,
  pubkey2index: PubkeyIndexMap
): StateValidatorIndexResponse {
  let validatorIndex: ValidatorIndex | undefined;
  if (typeof id === "string") {
    if (id.startsWith("0x")) {
      // mutate `id` and fallthrough to below
      try {
        id = fromHexString(id);
      } catch (e) {
        return {valid: false, code: 400, reason: "Invalid pubkey hex encoding"};
      }
    } else {
      validatorIndex = Number(id);
      // validator is invalid or added later than given stateId
      if (!Number.isSafeInteger(validatorIndex)) {
        return {valid: false, code: 400, reason: "Invalid validator index"};
      }
      if (validatorIndex >= state.validators.length) {
        return {valid: false, code: 404, reason: "Validator index from future state"};
      }
      return {valid: true, validatorIndex};
    }
  }

  // typeof id === Uint8Array
  validatorIndex = pubkey2index.get(id as BLSPubkey);
  if (validatorIndex === undefined) {
    return {valid: false, code: 404, reason: "Validator pubkey not found in state"};
  }
  if (validatorIndex >= state.validators.length) {
    return {valid: false, code: 404, reason: "Validator pubkey from future state"};
  }
  return {valid: true, validatorIndex};
}
