import {type PubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {routes} from "@lodestar/api";
import {CheckpointWithHex, IForkChoice} from "@lodestar/fork-choice";
import {GENESIS_SLOT} from "@lodestar/params";
import {IBeaconStateView, IBeaconStateViewGloas} from "@lodestar/state-transition";
import {
  BLSPubkey,
  BuilderIndex,
  Epoch,
  RootHex,
  Slot,
  ValidatorIndex,
  getValidatorStatus,
  phase0,
} from "@lodestar/types";
import {byteArrayEquals, fromHex} from "@lodestar/utils";
import {IBeaconChain} from "../../../../chain/index.js";
import {IBeaconSync} from "../../../../sync/index.js";
import {ApiError, ValidationError} from "../../errors.js";
import {notWhileSyncing} from "../../utils.js";

export function resolveStateId(
  forkChoice: IForkChoice,
  stateId: routes.beacon.StateId
): RootHex | Slot | CheckpointWithHex {
  if (stateId === "head") {
    return forkChoice.getHead().stateRoot;
  }

  if (stateId === "genesis") {
    return GENESIS_SLOT;
  }

  if (stateId === "finalized") {
    return forkChoice.getFinalizedCheckpoint();
  }

  if (stateId === "justified") {
    return forkChoice.getJustifiedCheckpoint();
  }

  if (typeof stateId === "string" && stateId.startsWith("0x")) {
    return stateId;
  }

  // id must be slot
  const blockSlot = parseInt(String(stateId), 10);
  if (Number.isNaN(blockSlot) && Number.isNaN(blockSlot - 0)) {
    throw new ValidationError(`Invalid block id '${stateId}'`, "blockId");
  }

  return blockSlot;
}

export async function getStateResponseWithRegen(
  chain: IBeaconChain,
  sync: IBeaconSync,
  inStateId: routes.beacon.StateId
): Promise<{state: IBeaconStateView | Uint8Array; executionOptimistic: boolean; finalized: boolean}> {
  // "head", "finalized" and "justified" resolve to already-available cached states, and "genesis" to a
  // historical DB read - none trigger the forward regen that can walk back past the block-root window
  // (SLOTS_PER_HISTORICAL_ROOT) and wedge a far-behind node. Keep serving those (node observability,
  // dashboards, validator client checks) even while syncing; guard only the regen-capable lookups.
  if (inStateId !== "head" && inStateId !== "finalized" && inStateId !== "justified" && inStateId !== "genesis") {
    notWhileSyncing(chain, sync.state);
  }

  const stateId = resolveStateId(chain.forkChoice, inStateId);

  const res =
    typeof stateId === "string"
      ? await chain.getStateByStateRoot(stateId, {allowRegen: true})
      : typeof stateId === "number"
        ? stateId > chain.clock.currentSlot
          ? null // Don't try to serve future slots
          : stateId >= chain.forkChoice.getFinalizedBlock().slot
            ? await chain.getStateBySlot(stateId, {allowRegen: true})
            : await chain.getHistoricalStateBySlot(stateId)
        : await chain.getStateOrBytesByCheckpoint(stateId);

  if (!res) {
    throw new ApiError(404, `State not found for id '${inStateId}'`);
  }

  return res;
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

type StateBuilderIndexResponse =
  | {valid: true; builderIndex: BuilderIndex}
  | {valid: false; code: number; reason: string};

export function getStateBuilderIndex(
  id: routes.beacon.BuilderId | BLSPubkey,
  state: IBeaconStateViewGloas
): StateBuilderIndexResponse {
  if (typeof id === "string") {
    // mutate `id` and fallthrough to below
    if (id.startsWith("0x")) {
      try {
        id = fromHex(id);
      } catch (_e) {
        return {valid: false, code: 400, reason: "Invalid pubkey hex encoding"};
      }
    } else {
      id = Number(id);
    }
  }

  if (typeof id === "number") {
    const builderIndex = id;
    // builder is invalid or added later than given stateId
    if (!Number.isSafeInteger(builderIndex) || builderIndex < 0) {
      return {valid: false, code: 400, reason: "Invalid builder index"};
    }
    if (builderIndex >= state.getBuildersLength()) {
      return {valid: false, code: 404, reason: "Builder index from future state"};
    }
    return {valid: true, builderIndex};
  }

  // typeof id === Uint8Array
  // There is no builder pubkey cache, linear scan over the registry
  const buildersLength = state.getBuildersLength();
  for (let builderIndex = 0; builderIndex < buildersLength; builderIndex++) {
    if (byteArrayEquals(state.getBuilder(builderIndex).pubkey, id)) {
      return {valid: true, builderIndex};
    }
  }
  return {valid: false, code: 404, reason: "Builder pubkey not found in state"};
}

export function filterStateValidatorsByStatus(
  statuses: string[],
  state: IBeaconStateView,
  pubkeyCache: PubkeyCache,
  currentEpoch: Epoch
): routes.beacon.ValidatorResponse[] {
  const responses: routes.beacon.ValidatorResponse[] = [];
  const validators = state.getValidatorsByStatus(new Set(statuses), currentEpoch);
  for (const validator of validators) {
    const resp = getStateValidatorIndex(validator.pubkey, state, pubkeyCache);
    if (resp.valid) {
      responses.push(
        toValidatorResponse(resp.validatorIndex, validator, state.getBalance(resp.validatorIndex), currentEpoch)
      );
    }
  }
  return responses;
}

type StateValidatorIndexResponse =
  | {valid: true; validatorIndex: ValidatorIndex}
  | {valid: false; code: number; reason: string};

export function getStateValidatorIndex(
  id: routes.beacon.ValidatorId | BLSPubkey,
  state: IBeaconStateView,
  pubkeyCache: PubkeyCache
): StateValidatorIndexResponse {
  if (typeof id === "string") {
    // mutate `id` and fallthrough to below
    if (id.startsWith("0x")) {
      try {
        id = fromHex(id);
      } catch (_e) {
        return {valid: false, code: 400, reason: "Invalid pubkey hex encoding"};
      }
    } else {
      id = Number(id);
    }
  }

  if (typeof id === "number") {
    const validatorIndex = id;
    // validator is invalid or added later than given stateId
    if (!Number.isSafeInteger(validatorIndex) || validatorIndex < 0) {
      return {valid: false, code: 400, reason: "Invalid validator index"};
    }
    if (validatorIndex >= state.validatorCount) {
      return {valid: false, code: 404, reason: "Validator index from future state"};
    }
    return {valid: true, validatorIndex};
  }

  // typeof id === Uint8Array
  const validatorIndex = pubkeyCache.getIndex(id);
  if (validatorIndex === null) {
    return {valid: false, code: 404, reason: "Validator pubkey not found in state"};
  }
  if (validatorIndex >= state.validatorCount) {
    return {valid: false, code: 404, reason: "Validator pubkey from future state"};
  }
  return {valid: true, validatorIndex};
}
