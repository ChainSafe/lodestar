import {Epoch, ValidatorIndex, ssz} from "@lodestar/types";
import {FAR_FUTURE_EPOCH, GENESIS_SLOT, UNSET_DEPOSIT_REQUESTS_START_INDEX} from "@lodestar/params";
import {CachedBeaconStateDeneb} from "../types.js";
import {CachedBeaconStateElectra, getCachedBeaconState} from "../cache/stateCache.js";
import {hasCompoundingWithdrawalCredential, queueExcessActiveBalance} from "../util/electra.js";
import {computeActivationExitEpoch} from "../util/epoch.js";
import {getActivationExitChurnLimit, getConsolidationChurnLimit} from "../util/validator.js";
import {G2_POINT_AT_INFINITY} from "../constants/constants.js";

/**
 * Upgrade a state from Deneb to Electra.
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
  stateElectraView.latestExecutionPayloadHeader = stateElectraCloned.latestExecutionPayloadHeader;
  stateElectraView.nextWithdrawalIndex = stateDeneb.nextWithdrawalIndex;
  stateElectraView.nextWithdrawalValidatorIndex = stateDeneb.nextWithdrawalValidatorIndex;
  stateElectraView.historicalSummaries = stateElectraCloned.historicalSummaries;

  // default value of depositRequestsStartIndex is UNSET_DEPOSIT_REQUESTS_START_INDEX
  stateElectraView.depositRequestsStartIndex = UNSET_DEPOSIT_REQUESTS_START_INDEX;
  stateElectraView.depositBalanceToConsume = BigInt(0);
  stateElectraView.exitBalanceToConsume = BigInt(0);

  const validatorsArr = stateElectraView.validators.getAllReadonly();
  const exitEpochs: Epoch[] = [];

  // [EIP-7251]: add validators that are not yet active to pending balance deposits
  const preActivation: ValidatorIndex[] = [];
  for (let validatorIndex = 0; validatorIndex < validatorsArr.length; validatorIndex++) {
    const {activationEpoch, exitEpoch} = validatorsArr[validatorIndex];
    if (activationEpoch === FAR_FUTURE_EPOCH) {
      preActivation.push(validatorIndex);
    }
    if (exitEpoch !== FAR_FUTURE_EPOCH) {
      exitEpochs.push(exitEpoch);
    }
  }

  const currentEpochPre = stateDeneb.epochCtx.epoch;

  if (exitEpochs.length === 0) {
    exitEpochs.push(currentEpochPre);
  }
  stateElectraView.earliestExitEpoch = Math.max(...exitEpochs) + 1;
  stateElectraView.consolidationBalanceToConsume = BigInt(0);
  stateElectraView.earliestConsolidationEpoch = computeActivationExitEpoch(currentEpochPre);
  // TODO-electra: can we improve this?
  stateElectraView.commit();
  const tmpElectraState = getCachedBeaconState(stateElectraView, stateDeneb);
  stateElectraView.exitBalanceToConsume = BigInt(getActivationExitChurnLimit(tmpElectraState.epochCtx));
  stateElectraView.consolidationBalanceToConsume = BigInt(getConsolidationChurnLimit(tmpElectraState.epochCtx));

  preActivation.sort((i0, i1) => {
    const res = validatorsArr[i0].activationEligibilityEpoch - validatorsArr[i1].activationEligibilityEpoch;
    return res !== 0 ? res : i0 - i1;
  });

  for (const validatorIndex of preActivation) {
    const stateElectra = stateElectraView as CachedBeaconStateElectra;
    const balance = stateElectra.balances.get(validatorIndex);
    stateElectra.balances.set(validatorIndex, 0);

    const validator = stateElectra.validators.get(validatorIndex);
    validator.effectiveBalance = 0;
    stateElectra.epochCtx.effectiveBalanceIncrementsSet(validatorIndex, 0);
    validator.activationEligibilityEpoch = FAR_FUTURE_EPOCH;

    const pendingDeposit = ssz.electra.PendingDeposit.toViewDU({
      pubkey: validator.pubkey,
      withdrawalCredentials: validator.withdrawalCredentials,
      amount: balance,
      signature: G2_POINT_AT_INFINITY,
      slot: GENESIS_SLOT,
    });
    stateElectra.pendingDeposits.push(pendingDeposit);
  }

  for (let i = 0; i < validatorsArr.length; i++) {
    const validator = validatorsArr[i];

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
  // biome-ignore lint/complexity/useLiteralKeys: It is a protected attribute
  stateElectra["clearCache"]();

  return stateElectra;
}
