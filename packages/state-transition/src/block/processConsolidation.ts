import {toHexString} from "@chainsafe/ssz";
import {electra, ssz} from "@lodestar/types";
import {FAR_FUTURE_EPOCH, MIN_ACTIVATION_BALANCE, PENDING_CONSOLIDATIONS_LIMIT} from "@lodestar/params";
import {verifyConsolidationSignature} from "../signatureSets/index.js";

import {CachedBeaconStateElectra} from "../types.js";
import { getConsolidationChurnLimit, isActiveValidator } from "../util/validator.js";
import { hasExecutionWithdrawalCredential } from "../util/capella.js";

export function processConsolidation(
  state: CachedBeaconStateElectra,
  signedConsolidation: electra.SignedConsolidation,
): void {


  assertValidConsolidation(state, signedConsolidation);

  // Initiate source validator exit and append pending consolidation
  const {sourceIndex, targetIndex} = signedConsolidation.message;
  const activeBalance = 0; // TODO Electra: get_active_balance()
  const sourceValidator = state.validators.get(sourceIndex);

  const exitEpoch = 0; // TODO Electra: compute_consolidation_epoch_and_update_churn
  sourceValidator.exitEpoch = exitEpoch; 
  sourceValidator.withdrawableEpoch = exitEpoch + state.config.MIN_VALIDATOR_WITHDRAWABILITY_DELAY;

  const pendingConsolidation = ssz.electra.PendingConsolidation.toViewDU({
    sourceIndex,
    targetIndex
  });
  state.pendingConsolidations.push(pendingConsolidation);

}

function assertValidConsolidation(state: CachedBeaconStateElectra, signedConsolidation: electra.SignedConsolidation) {
  // If the pending consolidations queue is full, no consolidations are allowed in the block
  if (state.pendingConsolidations.length >= PENDING_CONSOLIDATIONS_LIMIT) {
    throw new Error(`Pending consolidation queue is full`);
  }

  // If there is too little available consolidation churn limit, no consolidations are allowed in the block
  // assert get_consolidation_churn_limit(state) > MIN_ACTIVATION_BALANCE
  if (getConsolidationChurnLimit(state) <= MIN_ACTIVATION_BALANCE) {
    throw new Error(`Consolidation churn limit too low. consolidationChurnLimit=${getConsolidationChurnLimit(state)}`);
  }


  const consolidation = signedConsolidation.message;
  const {sourceIndex, targetIndex} = consolidation;

  // Verify that source != target, so a consolidation cannot be used as an exit.
  if (sourceIndex === targetIndex) {
    throw new Error(`Consolidation source and target index cannot be the same: sourceIndex=${sourceIndex} targetIndex=${targetIndex}`);
  }


  const sourceValidator = state.validators.getReadonly(sourceIndex);
  const targetValidator = state.validators.getReadonly(targetIndex);
  const currentEpoch = state.epochCtx.epoch;

  // Verify the source and the target are active
  if (!isActiveValidator(sourceValidator, currentEpoch)) {
    throw new Error(`Consolidation source validator is not active: sourceIndex=${sourceIndex}`);
  }

  if (!isActiveValidator(targetValidator, currentEpoch)) {
    throw new Error(`Consolidation target validator is not active: targetIndex=${targetIndex}`);
  }

  // Verify exits for source and target have not been initiated
  if (sourceValidator.exitEpoch !== FAR_FUTURE_EPOCH){
    throw new Error(`Consolidation source validator has initialized exit: sourceIndex=${sourceIndex}`);
  }
  if (targetValidator.exitEpoch !== FAR_FUTURE_EPOCH){
    throw new Error(`Consolidation target validator has initialized exit: targetIndex=${targetIndex}`);
  }

  // Consolidations must specify an epoch when they become valid; they are not valid before then
  if (currentEpoch < consolidation.epoch) {
    throw new Error(`Consolidation epoch is after the current epoch: consolidationEpoch=${consolidation.epoch} currentEpoch=${currentEpoch}`);
  }

  // Verify the source and the target have Execution layer withdrawal credentials
  if (!hasExecutionWithdrawalCredential(sourceValidator.withdrawalCredentials)) {
    throw new Error(`Consolidation source validator does not have execution withdrawal credentials: sourceIndex=${sourceIndex}`);
  }
  if (!hasExecutionWithdrawalCredential(targetValidator.withdrawalCredentials)) {
    throw new Error(`Consolidation target validator does not have execution withdrawal credentials: targetIndex=${targetIndex}`);
  }

  // Verify the same withdrawal address
  const sourceWithdrawalAddress = toHexString(sourceValidator.withdrawalCredentials.slice(1));
  const targetWithdrawalAddress = toHexString(targetValidator.withdrawalCredentials.slice(1));

  if (sourceWithdrawalAddress !== targetWithdrawalAddress) {
    throw new Error(`Consolidation source and target withdrawal address are different: source: ${sourceWithdrawalAddress} target: ${targetWithdrawalAddress}`);
  }

  // Verify consolidation is signed by the source and the target
  if (!verifyConsolidationSignature(state, signedConsolidation)) {
    throw new Error("Consolidation not valid");
  }
}