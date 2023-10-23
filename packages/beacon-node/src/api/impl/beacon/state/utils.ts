import {fromHexString} from "@chainsafe/ssz";
import {routes} from "@lodestar/api";
import {FAR_FUTURE_EPOCH, GENESIS_SLOT} from "@lodestar/params";
import {BeaconStateAllForks, PubkeyIndexMap} from "@lodestar/state-transition";
import {BLSPubkey, phase0} from "@lodestar/types";
import {Epoch, ValidatorIndex} from "@lodestar/types";
import {IBeaconChain, StateGetOpts} from "../../../../chain/index.js";
import {ApiError, ValidationError} from "../../errors.js";
import {isOptimisticBlock} from "../../../../util/forkChoice.js";

export async function resolveStateId(
  chain: IBeaconChain,
  stateId: routes.beacon.StateId,
  opts?: StateGetOpts
): Promise<{state: BeaconStateAllForks; executionOptimistic: boolean}> {
  const stateRes = await resolveStateIdOrNull(chain, stateId, opts);
  if (!stateRes) {
    throw new ApiError(404, `No state found for id '${stateId}'`);
  }

  return stateRes;
}

async function resolveStateIdOrNull(
  chain: IBeaconChain,
  stateId: routes.beacon.StateId,
  opts?: StateGetOpts
): Promise<{state: BeaconStateAllForks; executionOptimistic: boolean} | null> {
  if (stateId === "head") {
    // TODO: This is not OK, head and headState must be fetched atomically
    const head = chain.forkChoice.getHead();
    const headState = chain.getHeadState();
    return {state: headState, executionOptimistic: isOptimisticBlock(head)};
  }

  if (stateId === "genesis") {
    return chain.getStateBySlot(GENESIS_SLOT, opts);
  }

  if (stateId === "finalized") {
    const block = chain.forkChoice.getFinalizedBlock();
    const state = await chain.getStateByStateRoot(block.stateRoot, opts);
    return state && {state: state.state, executionOptimistic: isOptimisticBlock(block)};
  }

  if (stateId === "justified") {
    const block = chain.forkChoice.getJustifiedBlock();
    const state = await chain.getStateByStateRoot(block.stateRoot, opts);
    return state && {state: state.state, executionOptimistic: isOptimisticBlock(block)};
  }

  if (typeof stateId === "string" && stateId.startsWith("0x")) {
    return chain.getStateByStateRoot(stateId, opts);
  }

  // id must be slot
  const blockSlot = parseInt(String(stateId), 10);
  if (isNaN(blockSlot) && isNaN(blockSlot - 0)) {
    throw new ValidationError(`Invalid block id '${stateId}'`, "blockId");
  }

  return chain.getStateBySlot(blockSlot, opts);
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
