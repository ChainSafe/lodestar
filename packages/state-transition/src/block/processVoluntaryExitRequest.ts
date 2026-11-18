import {FAR_FUTURE_EPOCH, ForkSeq} from "@lodestar/params";
import {pq} from "@lodestar/types";
import {CachedBeaconStateGloas, CachedBeaconStatePq} from "../types.js";
import {getPendingBalanceToWithdraw, isActiveValidator} from "../util/validator.js";
import {initiateValidatorExit} from "./initiateValidatorExit.js";

/**
 * From pq a voluntary exit is an execution layer request. The system contract verifies the
 * validator's signature before it emits the request.
 */
export function processVoluntaryExitRequest(state: CachedBeaconStatePq, request: pq.VoluntaryExitRequest): void {
  const validatorIndex = state.epochCtx.getValidatorIndex(request.pubkey);
  if (validatorIndex === null || validatorIndex >= state.validators.length) return;
  const validator = state.validators.get(validatorIndex);
  const currentEpoch = state.epochCtx.epoch;

  if (!isActiveValidator(validator, currentEpoch)) return;
  if (validator.exitEpoch !== FAR_FUTURE_EPOCH) return;
  if (currentEpoch < validator.activationEpoch + state.config.SHARD_COMMITTEE_PERIOD) return;
  if (getPendingBalanceToWithdraw(state as unknown as CachedBeaconStateGloas, validatorIndex) !== 0) return;

  initiateValidatorExit(ForkSeq.pq, state, validator);
}
