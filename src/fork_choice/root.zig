const std = @import("std");
const testing = std.testing;

pub const vote_tracker = @import("vote_tracker.zig");
pub const compute_deltas = @import("compute_deltas.zig");
pub const proto_array = @import("proto_array.zig");
pub const store = @import("store.zig");
pub const fork_choice = @import("fork_choice.zig");
pub const metrics = @import("metrics.zig");

pub const ProtoBlock = proto_array.ProtoBlock;
pub const ProtoNode = proto_array.ProtoNode;
pub const ExecutionStatus = proto_array.ExecutionStatus;
pub const DataAvailabilityStatus = proto_array.DataAvailabilityStatus;
pub const PayloadStatus = proto_array.PayloadStatus;
pub const BlockExtraMeta = proto_array.BlockExtraMeta;
pub const LVHExecResponse = proto_array.LVHExecResponse;
pub const LVHValidResponse = proto_array.LVHValidResponse;
pub const LVHInvalidResponse = proto_array.LVHInvalidResponse;
pub const LVHExecErrorCode = proto_array.LVHExecErrorCode;

pub const ProtoArrayError = proto_array.ProtoArrayError;
pub const ForkChoiceError = fork_choice.ForkChoiceError;
pub const InvalidBlockCode = proto_array.InvalidBlockCode;
pub const InvalidAttestationCode = proto_array.InvalidAttestationCode;

pub const ProtoArray = proto_array.ProtoArray;
pub const DEFAULT_PRUNE_THRESHOLD = proto_array.DEFAULT_PRUNE_THRESHOLD;
pub const VariantIndices = proto_array.VariantIndices;
pub const RootContext = proto_array.RootContext;

pub const VoteTracker = vote_tracker.VoteTracker;
pub const Votes = vote_tracker.Votes;
pub const NULL_VOTE_INDEX = vote_tracker.NULL_VOTE_INDEX;
pub const INIT_VOTE_SLOT = vote_tracker.INIT_VOTE_SLOT;

pub const computeDeltas = compute_deltas.computeDeltas;
pub const ComputeDeltasResult = compute_deltas.ComputeDeltasResult;
pub const DeltasCache = compute_deltas.DeltasCache;
pub const EquivocatingIndices = compute_deltas.EquivocatingIndices;
pub const VoteIndex = compute_deltas.VoteIndex;

pub const ForkChoice = fork_choice.ForkChoice;
pub const ValidatorVoteMap = fork_choice.ValidatorVoteMap;
pub const BlockAttestationMap = fork_choice.BlockAttestationMap;
pub const QueuedAttestationMap = fork_choice.QueuedAttestationMap;
pub const RootSet = fork_choice.RootSet;

pub const ForkChoiceStore = store.ForkChoiceStore;
pub const Checkpoint = store.Checkpoint;
pub const EffectiveBalanceIncrementsRc = store.JustifiedBalancesRc;
pub const JustifiedBalances = store.JustifiedBalances;
pub const JustifiedBalancesGetter = store.JustifiedBalancesGetter;
pub const EventCallback = store.EventCallback;
pub const ForkChoiceStoreEvents = store.ForkChoiceStoreEvents;
pub const computeTotalBalance = store.computeTotalBalance;

pub const EpochDifference = fork_choice.EpochDifference;
pub const AncestorStatus = fork_choice.AncestorStatus;
pub const AncestorResult = fork_choice.AncestorResult;
pub const NotReorgedReason = fork_choice.NotReorgedReason;
pub const ShouldOverrideForkChoiceUpdateResult = fork_choice.ShouldOverrideForkChoiceUpdateResult;
pub const ForkChoiceOpts = fork_choice.ForkChoiceOpts;
pub const UpdateHeadOpt = fork_choice.UpdateHeadOpt;
pub const UpdateAndGetHeadOpt = fork_choice.UpdateAndGetHeadOpt;
pub const UpdateAndGetHeadResult = fork_choice.UpdateAndGetHeadResult;
pub const CheckpointWithBalance = fork_choice.CheckpointWithBalance;
pub const CheckpointWithTotalBalance = fork_choice.CheckpointWithTotalBalance;
pub const onBlockFromProto = fork_choice.onBlockFromProto;

test {
    testing.refAllDecls(@This());
}
