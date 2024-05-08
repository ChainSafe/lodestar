import {ssz} from "@lodestar/types";
import {FAR_FUTURE_EPOCH, UNSET_DEPOSIT_RECEIPTS_START_INDEX} from "@lodestar/params";
import {CachedBeaconStateDeneb} from "../types.js";
import {CachedBeaconStateElectra, getCachedBeaconState} from "../cache/stateCache.js";
import {
  hasCompoundingWithdrawalCredential,
  queueEntireBalanceAndResetValidator,
  queueExcessActiveBalance,
} from "../util/electra.js";

/**
 * Upgrade a state from Capella to Deneb.
 */
export function upgradeStateToElectra(stateDeneb: CachedBeaconStateDeneb): CachedBeaconStateElectra {
  const {config} = stateDeneb;

  const stateElectraNode = ssz.deneb.BeaconState.commitViewDU(stateDeneb);
  const stateElectraView = ssz.electra.BeaconState.getViewDU(stateElectraNode);

  const stateElectra = getCachedBeaconState(stateElectraView, stateDeneb);

  stateElectra.fork = ssz.phase0.Fork.toViewDU({
    previousVersion: stateDeneb.fork.currentVersion,
    currentVersion: config.ELECTRA_FORK_VERSION,
    epoch: stateDeneb.epochCtx.epoch,
  });

  // latestExecutionPayloadHeader's depositRequestsRoot and withdrawalRequestsRoot set to zeros by default
  // default value of depositRequestsStartIndex is UNSET_DEPOSIT_RECEIPTS_START_INDEX
  stateElectra.depositRequestsStartIndex = UNSET_DEPOSIT_RECEIPTS_START_INDEX;

  const validatorsArr = stateElectra.validators.getAllReadonly();

  for (let i = 0; i < validatorsArr.length; i++) {
    const validator = validatorsArr[i];

    // [EIP-7251]: add validators that are not yet active to pending balance deposits
    if (validator.activationEligibilityEpoch === FAR_FUTURE_EPOCH) {
      queueEntireBalanceAndResetValidator(stateElectra, i);
    }

    // [EIP-7251]: Ensure early adopters of compounding credentials go through the activation churn
    const withdrawalCredential = validator.withdrawalCredentials;
    if (hasCompoundingWithdrawalCredential(withdrawalCredential)) {
      queueExcessActiveBalance(stateElectra, i);
    }
  }

  // Commit new added fields ViewDU to the root node
  stateElectra.commit();
  // Clear cache to ensure the cache of deneb fields is not used by new ELECTRA fields
  stateElectra["clearCache"]();

  return stateElectra;
}
