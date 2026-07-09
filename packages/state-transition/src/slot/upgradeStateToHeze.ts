import {ssz} from "@lodestar/types";
import {getCachedBeaconState} from "../cache/stateCache.js";
import {CachedBeaconStateGloas, CachedBeaconStateHeze} from "../types.js";

/**
 * Upgrade a state from Gloas to Heze.
 * Spec: heze/fork.md `upgrade_to_heze`.
 */
export function upgradeStateToHeze(stateGloas: CachedBeaconStateGloas): CachedBeaconStateHeze {
  const {config} = stateGloas;

  ssz.gloas.BeaconState.commitViewDU(stateGloas);
  const stateHezeCloned = stateGloas;

  const stateHezeView = ssz.heze.BeaconState.defaultViewDU();

  stateHezeView.genesisTime = stateHezeCloned.genesisTime;
  stateHezeView.genesisValidatorsRoot = stateHezeCloned.genesisValidatorsRoot;
  stateHezeView.slot = stateHezeCloned.slot;
  stateHezeView.fork = ssz.phase0.Fork.toViewDU({
    previousVersion: stateGloas.fork.currentVersion,
    currentVersion: config.HEZE_FORK_VERSION,
    epoch: stateGloas.epochCtx.epoch,
  });
  stateHezeView.latestBlockHeader = stateHezeCloned.latestBlockHeader;
  stateHezeView.blockRoots = stateHezeCloned.blockRoots;
  stateHezeView.stateRoots = stateHezeCloned.stateRoots;
  stateHezeView.historicalRoots = stateHezeCloned.historicalRoots;
  stateHezeView.eth1Data = stateHezeCloned.eth1Data;
  stateHezeView.eth1DataVotes = stateHezeCloned.eth1DataVotes;
  stateHezeView.eth1DepositIndex = stateHezeCloned.eth1DepositIndex;
  stateHezeView.validators = stateHezeCloned.validators;
  stateHezeView.balances = stateHezeCloned.balances;
  stateHezeView.randaoMixes = stateHezeCloned.randaoMixes;
  stateHezeView.slashings = stateHezeCloned.slashings;
  stateHezeView.previousEpochParticipation = stateHezeCloned.previousEpochParticipation;
  stateHezeView.currentEpochParticipation = stateHezeCloned.currentEpochParticipation;
  stateHezeView.justificationBits = stateHezeCloned.justificationBits;
  stateHezeView.previousJustifiedCheckpoint = stateHezeCloned.previousJustifiedCheckpoint;
  stateHezeView.currentJustifiedCheckpoint = stateHezeCloned.currentJustifiedCheckpoint;
  stateHezeView.finalizedCheckpoint = stateHezeCloned.finalizedCheckpoint;
  stateHezeView.inactivityScores = stateHezeCloned.inactivityScores;
  stateHezeView.currentSyncCommittee = stateHezeCloned.currentSyncCommittee;
  stateHezeView.nextSyncCommittee = stateHezeCloned.nextSyncCommittee;
  stateHezeView.latestBlockHash = stateHezeCloned.latestBlockHash;
  stateHezeView.nextWithdrawalIndex = stateHezeCloned.nextWithdrawalIndex;
  stateHezeView.nextWithdrawalValidatorIndex = stateHezeCloned.nextWithdrawalValidatorIndex;
  stateHezeView.historicalSummaries = stateHezeCloned.historicalSummaries;
  stateHezeView.depositRequestsStartIndex = stateHezeCloned.depositRequestsStartIndex;
  stateHezeView.depositBalanceToConsume = stateHezeCloned.depositBalanceToConsume;
  stateHezeView.exitBalanceToConsume = stateHezeCloned.exitBalanceToConsume;
  stateHezeView.earliestExitEpoch = stateHezeCloned.earliestExitEpoch;
  stateHezeView.consolidationBalanceToConsume = stateHezeCloned.consolidationBalanceToConsume;
  stateHezeView.earliestConsolidationEpoch = stateHezeCloned.earliestConsolidationEpoch;
  stateHezeView.pendingDeposits = stateHezeCloned.pendingDeposits;
  stateHezeView.pendingPartialWithdrawals = stateHezeCloned.pendingPartialWithdrawals;
  stateHezeView.pendingConsolidations = stateHezeCloned.pendingConsolidations;
  stateHezeView.proposerLookahead = stateHezeCloned.proposerLookahead;
  stateHezeView.builders = stateHezeCloned.builders;
  stateHezeView.nextWithdrawalBuilderIndex = stateHezeCloned.nextWithdrawalBuilderIndex;
  stateHezeView.executionPayloadAvailability = stateHezeCloned.executionPayloadAvailability;
  stateHezeView.builderPendingPayments = stateHezeCloned.builderPendingPayments;
  stateHezeView.builderPendingWithdrawals = stateHezeCloned.builderPendingWithdrawals;

  // [Modified in Heze:EIP7805] inclusion_list_bits = Bitvector[INCLUSION_LIST_COMMITTEE_SIZE]() (default zero)
  const oldBid = stateHezeCloned.latestExecutionPayloadBid;
  const newBid = ssz.heze.ExecutionPayloadBid.defaultViewDU();
  newBid.parentBlockHash = oldBid.parentBlockHash;
  newBid.parentBlockRoot = oldBid.parentBlockRoot;
  newBid.blockHash = oldBid.blockHash;
  newBid.prevRandao = oldBid.prevRandao;
  newBid.feeRecipient = oldBid.feeRecipient;
  newBid.gasLimit = oldBid.gasLimit;
  newBid.builderIndex = oldBid.builderIndex;
  newBid.slot = oldBid.slot;
  newBid.value = oldBid.value;
  newBid.executionPayment = oldBid.executionPayment;
  newBid.blobKzgCommitments = oldBid.blobKzgCommitments;
  newBid.executionRequestsRoot = oldBid.executionRequestsRoot;
  stateHezeView.latestExecutionPayloadBid = newBid;

  stateHezeView.payloadExpectedWithdrawals = stateHezeCloned.payloadExpectedWithdrawals;
  stateHezeView.ptcWindow = stateHezeCloned.ptcWindow;

  const stateHeze = getCachedBeaconState(stateHezeView, stateGloas);
  stateHeze.commit();
  // biome-ignore lint/complexity/useLiteralKeys: It is a protected attribute
  stateHeze["clearCache"]();

  return stateHeze;
}
