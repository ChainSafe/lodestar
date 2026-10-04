import {ssz} from "@lodestar/types";
import {getCachedBeaconState} from "../cache/stateCache.js";
import {CachedBeaconStateDecoupled, CachedBeaconStateHeze} from "../types.js";
import {computeStartSlotAtEpoch} from "../util/epoch.js";
import {zeroProgressiveListBasicRootNode} from "../util/ssz.js";

/**
 * Upgrade a state from Heze to Decoupled.
 *
 * The spec has no fork transition yet (see DC-ISSUES.md "No fork transition in the spec"). The new
 * fields follow the Lean model's initial chain state: the target pair sits at height 1 on the fork's
 * latest block, the justified and finalized pairs sit at height 0 on the pre-fork justified and
 * finalized checkpoint roots with slots derived from those epochs, and every participation array is
 * zero. `latest_block_header.state_root` is already filled at the epoch boundary, so the target root
 * can be hashed directly here.
 */
export function upgradeStateToDecoupled(stateHeze: CachedBeaconStateHeze): CachedBeaconStateDecoupled {
  const {config} = stateHeze;

  ssz.heze.BeaconState.commitViewDU(stateHeze);
  const stateDecoupledCloned = stateHeze;

  const stateDecoupledView = ssz.decoupled.BeaconState.defaultViewDU();

  stateDecoupledView.genesisTime = stateDecoupledCloned.genesisTime;
  stateDecoupledView.genesisValidatorsRoot = stateDecoupledCloned.genesisValidatorsRoot;
  stateDecoupledView.slot = stateDecoupledCloned.slot;
  stateDecoupledView.fork = ssz.phase0.Fork.toViewDU({
    previousVersion: stateHeze.fork.currentVersion,
    currentVersion: config.DECOUPLED_FORK_VERSION,
    epoch: stateHeze.epochCtx.epoch,
  });
  stateDecoupledView.latestBlockHeader = stateDecoupledCloned.latestBlockHeader;
  stateDecoupledView.blockRoots = stateDecoupledCloned.blockRoots;
  stateDecoupledView.stateRoots = stateDecoupledCloned.stateRoots;
  stateDecoupledView.historicalRoots = stateDecoupledCloned.historicalRoots;
  stateDecoupledView.eth1Data = stateDecoupledCloned.eth1Data;
  stateDecoupledView.eth1DataVotes = stateDecoupledCloned.eth1DataVotes;
  stateDecoupledView.eth1DepositIndex = stateDecoupledCloned.eth1DepositIndex;
  stateDecoupledView.validators = stateDecoupledCloned.validators;
  stateDecoupledView.balances = stateDecoupledCloned.balances;
  stateDecoupledView.randaoMixes = stateDecoupledCloned.randaoMixes;
  stateDecoupledView.slashings = stateDecoupledCloned.slashings;
  stateDecoupledView.previousEpochParticipation = stateDecoupledCloned.previousEpochParticipation;
  stateDecoupledView.currentEpochParticipation = stateDecoupledCloned.currentEpochParticipation;
  stateDecoupledView.justificationBits = stateDecoupledCloned.justificationBits;
  stateDecoupledView.previousJustifiedCheckpoint = stateDecoupledCloned.previousJustifiedCheckpoint;
  stateDecoupledView.currentJustifiedCheckpoint = stateDecoupledCloned.currentJustifiedCheckpoint;
  stateDecoupledView.finalizedCheckpoint = stateDecoupledCloned.finalizedCheckpoint;
  stateDecoupledView.inactivityScores = stateDecoupledCloned.inactivityScores;
  stateDecoupledView.currentSyncCommittee = stateDecoupledCloned.currentSyncCommittee;
  stateDecoupledView.nextSyncCommittee = stateDecoupledCloned.nextSyncCommittee;
  stateDecoupledView.latestBlockHash = stateDecoupledCloned.latestBlockHash;
  stateDecoupledView.nextWithdrawalIndex = stateDecoupledCloned.nextWithdrawalIndex;
  stateDecoupledView.nextWithdrawalValidatorIndex = stateDecoupledCloned.nextWithdrawalValidatorIndex;
  stateDecoupledView.historicalSummaries = stateDecoupledCloned.historicalSummaries;
  stateDecoupledView.depositRequestsStartIndex = stateDecoupledCloned.depositRequestsStartIndex;
  stateDecoupledView.depositBalanceToConsume = stateDecoupledCloned.depositBalanceToConsume;
  stateDecoupledView.exitBalanceToConsume = stateDecoupledCloned.exitBalanceToConsume;
  stateDecoupledView.earliestExitEpoch = stateDecoupledCloned.earliestExitEpoch;
  stateDecoupledView.consolidationBalanceToConsume = stateDecoupledCloned.consolidationBalanceToConsume;
  stateDecoupledView.earliestConsolidationEpoch = stateDecoupledCloned.earliestConsolidationEpoch;
  stateDecoupledView.pendingDeposits = stateDecoupledCloned.pendingDeposits;
  stateDecoupledView.pendingPartialWithdrawals = stateDecoupledCloned.pendingPartialWithdrawals;
  stateDecoupledView.pendingConsolidations = stateDecoupledCloned.pendingConsolidations;
  stateDecoupledView.proposerLookahead = stateDecoupledCloned.proposerLookahead;
  stateDecoupledView.builders = stateDecoupledCloned.builders;
  stateDecoupledView.nextWithdrawalBuilderIndex = stateDecoupledCloned.nextWithdrawalBuilderIndex;
  stateDecoupledView.executionPayloadAvailability = stateDecoupledCloned.executionPayloadAvailability;
  stateDecoupledView.builderPendingPayments = stateDecoupledCloned.builderPendingPayments;
  stateDecoupledView.builderPendingWithdrawals = stateDecoupledCloned.builderPendingWithdrawals;
  stateDecoupledView.latestExecutionPayloadBid = stateDecoupledCloned.latestExecutionPayloadBid;
  stateDecoupledView.payloadExpectedWithdrawals = stateDecoupledCloned.payloadExpectedWithdrawals;
  // Kept as computed by the gloas compute_ptc, the DC variant only applies to epochs computed after the fork
  stateDecoupledView.ptcWindow = stateDecoupledCloned.ptcWindow;

  const validatorCount = stateDecoupledCloned.validators.length;
  const participationType = ssz.decoupled.BeaconState.fields.heightParticipation;
  const zeroParticipation = (): ReturnType<typeof participationType.getViewDU> =>
    participationType.getViewDU(zeroProgressiveListBasicRootNode(participationType.itemsPerChunk, validatorCount));
  stateDecoupledView.heightParticipation = zeroParticipation();
  stateDecoupledView.previousRoundParticipation = zeroParticipation();
  stateDecoupledView.currentRoundParticipation = zeroParticipation();

  const latestBlockHeader = stateDecoupledCloned.latestBlockHeader;
  stateDecoupledView.targetPair = ssz.decoupled.HeightPair.toViewDU({
    height: 1,
    root: latestBlockHeader.hashTreeRoot(),
  });
  stateDecoupledView.targetSlot = latestBlockHeader.slot;

  const justified = stateDecoupledCloned.currentJustifiedCheckpoint;
  stateDecoupledView.justifiedPair = ssz.decoupled.HeightPair.toViewDU({height: 0, root: justified.root});
  stateDecoupledView.justifiedSlot = computeStartSlotAtEpoch(justified.epoch);

  const finalized = stateDecoupledCloned.finalizedCheckpoint;
  stateDecoupledView.finalizedPair = ssz.decoupled.HeightPair.toViewDU({height: 0, root: finalized.root});
  stateDecoupledView.finalizedSlot = computeStartSlotAtEpoch(finalized.epoch);

  const stateDecoupled = getCachedBeaconState(stateDecoupledView, stateHeze);
  stateDecoupled.commit();
  // biome-ignore lint/complexity/useLiteralKeys: It is a protected attribute
  stateDecoupled["clearCache"]();

  return stateDecoupled;
}
