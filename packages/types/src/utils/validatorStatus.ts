import {FAR_FUTURE_EPOCH} from "@lodestar/params";
import {Epoch, gloas, phase0} from "../types.js";

/**
 * [Validator status specification](https://hackmd.io/ofFJ5gOmQpu1jjHilHbdQQ)
 */
export type ValidatorStatus =
  | "pending_initialized"
  | "pending_queued"
  | "active_ongoing"
  | "active_exiting"
  | "active_slashed"
  | "exited_unslashed"
  | "exited_slashed"
  | "withdrawal_possible"
  | "withdrawal_done";

export type GeneralValidatorStatus = "active" | "pending" | "exited" | "withdrawal";

/**
 * Get the status of the validator
 * based on conditions outlined in https://hackmd.io/ofFJ5gOmQpu1jjHilHbdQQ
 */
export function getValidatorStatus(validator: phase0.Validator, currentEpoch: Epoch): ValidatorStatus {
  // pending
  if (validator.activationEpoch > currentEpoch) {
    if (validator.activationEligibilityEpoch === FAR_FUTURE_EPOCH) {
      return "pending_initialized";
    }

    if (validator.activationEligibilityEpoch < FAR_FUTURE_EPOCH) {
      return "pending_queued";
    }
  }
  // active
  if (validator.activationEpoch <= currentEpoch && currentEpoch < validator.exitEpoch) {
    if (validator.exitEpoch === FAR_FUTURE_EPOCH) {
      return "active_ongoing";
    }

    if (validator.exitEpoch < FAR_FUTURE_EPOCH) {
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

/**
 * Statuses as defined in https://github.com/ethereum/beacon-APIs/pull/614
 */
export type BuilderStatus = "pending" | "active" | "exited";

/**
 * Get the status of the builder, `finalizedEpoch` refers to `state.finalized_checkpoint.epoch`
 */
export function getBuilderStatus(builder: gloas.Builder, finalizedEpoch: Epoch): BuilderStatus {
  if (builder.withdrawableEpoch !== FAR_FUTURE_EPOCH) {
    return "exited";
  }
  // Same as is_active_builder check with withdrawable epoch already confirmed to be FAR_FUTURE_EPOCH
  if (builder.depositEpoch < finalizedEpoch) {
    return "active";
  }
  return "pending";
}

export function mapToGeneralStatus(subStatus: ValidatorStatus): GeneralValidatorStatus {
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
