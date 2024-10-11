import {PubkeyIndexMap} from "@chainsafe/pubkey-index-map";
import {routes} from "@lodestar/api";
import {GENESIS_SLOT} from "@lodestar/params";
import {BeaconStateAllForks} from "@lodestar/state-transition";
import {BLSPubkey, Epoch, getValidatorStatus, phase0, RootHex, Slot, ValidatorIndex} from "@lodestar/types";
import {fromHex} from "@lodestar/utils";
import {CheckpointWithHex, IForkChoice} from "@lodestar/fork-choice";
import {IBeaconChain} from "../../../../chain/index.js";
import {ApiError, ValidationError} from "../../errors.js";

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
  if (isNaN(blockSlot) && isNaN(blockSlot - 0)) {
    throw new ValidationError(`Invalid block id '${stateId}'`, "blockId");
  }

  return blockSlot;
}

export async function getStateResponse(
  chain: IBeaconChain,
  inStateId: routes.beacon.StateId
): Promise<{state: BeaconStateAllForks; executionOptimistic: boolean; finalized: boolean}> {
  const stateId = resolveStateId(chain.forkChoice, inStateId);

  const res =
    typeof stateId === "string"
      ? await chain.getStateByStateRoot(stateId)
      : typeof stateId === "number"
        ? await chain.getStateBySlot(stateId)
        : chain.getStateByCheckpoint(stateId);

  if (!res) {
    throw new ApiError(404, `No state found for id '${inStateId}'`);
  }

  return res;
}

export async function getStateResponseWithRegen(
  chain: IBeaconChain,
  inStateId: routes.beacon.StateId
): Promise<{state: BeaconStateAllForks | Uint8Array; executionOptimistic: boolean; finalized: boolean}> {
  const stateId = resolveStateId(chain.forkChoice, inStateId);

  const res =
    typeof stateId === "string"
      ? await chain.getStateByStateRoot(stateId, {allowRegen: true})
      : typeof stateId === "number"
        ? stateId >= chain.forkChoice.getFinalizedBlock().slot
          ? await chain.getStateBySlot(stateId, {allowRegen: true})
          : await chain.getHistoricalStateBySlot(stateId)
        : await chain.getStateOrBytesByCheckpoint(stateId);

  if (!res) {
    throw new ApiError(404, `No state found for id '${inStateId}'`);
  }

  return res;
}

type GeneralValidatorStatus = "active" | "pending" | "exited" | "withdrawal";

function mapToGeneralStatus(subStatus: routes.beacon.ValidatorStatus): GeneralValidatorStatus {
  switch (subStatus) {
    case "active_ongoing":
    case "active_exiting":
    case "active_slashed":
      return "active";
    case "pending_initialized":
    case "pending_queued":
      return "pending";
    case "exited_slashed":
    case "exited_unslashed":
      return "exited";
    case "withdrawal_possible":
    case "withdrawal_done":
      return "withdrawal";
    default:
      throw new Error(`Unknown substatus: ${subStatus}`);
  }
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
    const generalStatus = mapToGeneralStatus(validatorStatus);

    const resp = getStateValidatorIndex(validator.pubkey, state, pubkey2index);
    if (resp.valid && (statusSet.has(validatorStatus) || statusSet.has(generalStatus))) {
      responses.push(
        toValidatorResponse(resp.validatorIndex, validator, state.balances.get(resp.validatorIndex), currentEpoch)
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
  state: BeaconStateAllForks,
  pubkey2index: PubkeyIndexMap
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
    if (!Number.isSafeInteger(validatorIndex)) {
      return {valid: false, code: 400, reason: "Invalid validator index"};
    }
    if (validatorIndex >= state.validators.length) {
      return {valid: false, code: 404, reason: "Validator index from future state"};
    }
    return {valid: true, validatorIndex};
  }

  // typeof id === Uint8Array
  const validatorIndex = pubkey2index.get(id);
  if (validatorIndex === null) {
    return {valid: false, code: 404, reason: "Validator pubkey not found in state"};
  }
  if (validatorIndex >= state.validators.length) {
    return {valid: false, code: 404, reason: "Validator pubkey from future state"};
  }
  return {valid: true, validatorIndex};
}
