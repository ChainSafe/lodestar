import {ssz} from "@lodestar/types";
import {getCachedBeaconState} from "../cache/stateCache.js";
import {CachedBeaconStateEip8453, CachedBeaconStateHeze} from "../types.js";
import {computeStartSlotAtEpoch} from "../util/epoch.js";
import {zeroProgressiveListBasicRootNode} from "../util/ssz.js";

/**
 * Upgrade a state from Heze to EIP8453.
 * Spec: specs/_features/eip8453/fork.md `upgrade_to_eip8453`.
 *
 * The finality gadget starts at height 0 from the last finalized Casper FFG checkpoint, and the target of
 * height 1 is the latest block before the upgrade. Participation in the last epoch before the upgrade is not
 * rewarded.
 */
export function upgradeStateToEip8453(stateHeze: CachedBeaconStateHeze): CachedBeaconStateEip8453 {
  const {config} = stateHeze;

  ssz.heze.BeaconState.commitViewDU(stateHeze);
  const pre = stateHeze;

  const post = ssz.eip8453.BeaconState.defaultViewDU();

  post.genesisTime = pre.genesisTime;
  post.genesisValidatorsRoot = pre.genesisValidatorsRoot;
  post.slot = pre.slot;
  post.fork = ssz.phase0.Fork.toViewDU({
    previousVersion: stateHeze.fork.currentVersion,
    currentVersion: config.EIP8453_FORK_VERSION,
    epoch: stateHeze.epochCtx.epoch,
  });
  post.latestBlockHeader = pre.latestBlockHeader;
  post.blockRoots = pre.blockRoots;
  post.stateRoots = pre.stateRoots;
  post.historicalRoots = pre.historicalRoots;
  post.validators = pre.validators;
  post.balances = pre.balances;
  post.randaoMixes = pre.randaoMixes;
  post.slashings = pre.slashings;
  // [Modified in EIP8453] removed previous_epoch_participation, current_epoch_participation, justification_bits,
  // previous_justified_checkpoint, current_justified_checkpoint and the Casper FFG finalized_checkpoint
  post.inactivityScores = pre.inactivityScores;
  post.currentSyncCommittee = pre.currentSyncCommittee;
  post.nextSyncCommittee = pre.nextSyncCommittee;
  post.latestBlockHash = pre.latestBlockHash;
  post.nextWithdrawalIndex = pre.nextWithdrawalIndex;
  post.nextWithdrawalValidatorIndex = pre.nextWithdrawalValidatorIndex;
  post.historicalSummaries = pre.historicalSummaries;
  post.depositBalanceToConsume = pre.depositBalanceToConsume;
  post.exitBalanceToConsume = pre.exitBalanceToConsume;
  post.earliestExitEpoch = pre.earliestExitEpoch;
  post.consolidationBalanceToConsume = pre.consolidationBalanceToConsume;
  post.earliestConsolidationEpoch = pre.earliestConsolidationEpoch;
  post.pendingDeposits = pre.pendingDeposits;
  post.pendingPartialWithdrawals = pre.pendingPartialWithdrawals;
  post.pendingConsolidations = pre.pendingConsolidations;
  post.proposerLookahead = pre.proposerLookahead;
  post.builders = pre.builders;
  post.nextWithdrawalBuilderIndex = pre.nextWithdrawalBuilderIndex;
  post.executionPayloadAvailability = pre.executionPayloadAvailability;
  post.builderPendingPayments = pre.builderPendingPayments;
  post.builderPendingWithdrawals = pre.builderPendingWithdrawals;
  post.latestExecutionPayloadBid = pre.latestExecutionPayloadBid;
  post.payloadExpectedWithdrawals = pre.payloadExpectedWithdrawals;
  post.ptcWindow = pre.ptcWindow;

  // [New in EIP8453]
  // latest_block_header.state_root is already filled at the epoch boundary, so the header hashes to the block root
  const latestBlockHeader = pre.latestBlockHeader;
  post.targetCheckpoint = ssz.eip8453.HeightCheckpoint.toViewDU({height: 1, root: latestBlockHeader.hashTreeRoot()});
  const finalized = pre.finalizedCheckpoint;
  post.justifiedCheckpoint = ssz.eip8453.HeightCheckpoint.toViewDU({height: 0, root: finalized.root});
  post.finalizedCheckpoint = ssz.eip8453.HeightCheckpoint.toViewDU({height: 0, root: finalized.root});
  post.targetSlot = latestBlockHeader.slot;
  post.finalizedSlot = computeStartSlotAtEpoch(finalized.epoch);

  const validatorCount = pre.validators.length;
  post.targetParticipation = zeroHeightParticipation(validatorCount);
  post.progressParticipation = zeroHeightParticipation(validatorCount);
  const roundParticipationType = ssz.eip8453.RoundParticipation;
  post.roundParticipation = roundParticipationType.getViewDU(
    zeroProgressiveListBasicRootNode(roundParticipationType.itemsPerChunk, validatorCount)
  );
  // pending_finality and head_vote_participation keep their default (empty) values

  const statePost = getCachedBeaconState(post, stateHeze);
  statePost.commit();
  // biome-ignore lint/complexity/useLiteralKeys: It is a protected attribute
  statePost["clearCache"]();

  return statePost;
}

/** A `HeightParticipation` of `length` validators, none participating, built from shared zero subtrees */
export function zeroHeightParticipation(length: number): ReturnType<typeof ssz.eip8453.HeightParticipation.getViewDU> {
  const type = ssz.eip8453.HeightParticipation;
  return type.getViewDU(zeroProgressiveListBasicRootNode(type.itemsPerChunk, length));
}
