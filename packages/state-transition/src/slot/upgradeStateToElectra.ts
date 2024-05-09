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

  ssz.deneb.BeaconState.commitViewDU(stateDeneb);
  const stateElectraCloned = stateDeneb;

  const stateElectraView = ssz.electra.BeaconState.defaultViewDU();
  stateElectraView.genesisTime = stateElectraCloned.genesisTime;
  stateElectraView.genesisValidatorsRoot = stateElectraCloned.genesisValidatorsRoot;
  stateElectraView.slot = stateElectraCloned.slot;
  stateElectraView.fork = ssz.phase0.Fork.toViewDU({
    previousVersion: stateDeneb.fork.currentVersion,
    currentVersion: config.ELECTRA_FORK_VERSION,
    epoch: stateDeneb.epochCtx.epoch,
  });
  stateElectraView.latestBlockHeader = stateElectraCloned.latestBlockHeader;
  stateElectraView.blockRoots = stateElectraCloned.blockRoots;
  stateElectraView.stateRoots = stateElectraCloned.stateRoots;
  stateElectraView.historicalRoots = stateElectraCloned.historicalRoots;
  stateElectraView.eth1Data = stateElectraCloned.eth1Data;
  stateElectraView.eth1DataVotes = stateElectraCloned.eth1DataVotes;
  stateElectraView.eth1DepositIndex = stateElectraCloned.eth1DepositIndex;
  stateElectraView.validators = stateElectraCloned.validators;
  stateElectraView.balances = stateElectraCloned.balances;
  stateElectraView.randaoMixes = stateElectraCloned.randaoMixes;
  stateElectraView.slashings = stateElectraCloned.slashings;
  stateElectraView.previousEpochParticipation = stateElectraCloned.previousEpochParticipation;
  stateElectraView.currentEpochParticipation = stateElectraCloned.currentEpochParticipation;
  stateElectraView.justificationBits = stateElectraCloned.justificationBits;
  stateElectraView.previousJustifiedCheckpoint = stateElectraCloned.previousJustifiedCheckpoint;
  stateElectraView.currentJustifiedCheckpoint = stateElectraCloned.currentJustifiedCheckpoint;
  stateElectraView.finalizedCheckpoint = stateElectraCloned.finalizedCheckpoint;
  stateElectraView.inactivityScores = stateElectraCloned.inactivityScores;
  stateElectraView.currentSyncCommittee = stateElectraCloned.currentSyncCommittee;
  stateElectraView.nextSyncCommittee = stateElectraCloned.nextSyncCommittee;
  stateElectraView.latestExecutionPayloadHeader = ssz.electra.BeaconState.fields.latestExecutionPayloadHeader.toViewDU({
    ...stateElectraCloned.latestExecutionPayloadHeader.toValue(),
    depositRequestsRoot: ssz.Root.defaultValue(),
    withdrawalRequestsRoot: ssz.Root.defaultValue(),
  });
  stateElectraView.nextWithdrawalIndex = stateDeneb.nextWithdrawalIndex;
  stateElectraView.nextWithdrawalValidatorIndex = stateDeneb.nextWithdrawalValidatorIndex;
  stateElectraView.historicalSummaries = stateElectraCloned.historicalSummaries;

  // latestExecutionPayloadHeader's depositRequestsRoot and withdrawalRequestsRoot set to zeros by default
  // default value of depositRequestsStartIndex is UNSET_DEPOSIT_RECEIPTS_START_INDEX
  stateElectraView.depositRequestsStartIndex = UNSET_DEPOSIT_RECEIPTS_START_INDEX;

  const validatorsArr = stateElectraView.validators.getAllReadonly();

  for (let i = 0; i < validatorsArr.length; i++) {
    const validator = validatorsArr[i];

    // [EIP-7251]: add validators that are not yet active to pending balance deposits
    if (validator.activationEligibilityEpoch === FAR_FUTURE_EPOCH) {
      queueEntireBalanceAndResetValidator(stateElectraView as CachedBeaconStateElectra, i);
    }

    // [EIP-7251]: Ensure early adopters of compounding credentials go through the activation churn
    const withdrawalCredential = validator.withdrawalCredentials;
    if (hasCompoundingWithdrawalCredential(withdrawalCredential)) {
      queueExcessActiveBalance(stateElectraView as CachedBeaconStateElectra, i);
    }
  }

  const stateElectra = getCachedBeaconState(stateElectraView, stateDeneb);
  // Commit new added fields ViewDU to the root node
  stateElectra.commit();
  // Clear cache to ensure the cache of deneb fields is not used by new ELECTRA fields
  stateElectra["clearCache"]();

  return stateElectra;
}

export function upgradeStateToElectraOriginal(stateDeneb: CachedBeaconStateDeneb): CachedBeaconStateElectra {
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
