//! Beacon chain fork choice (LMD-GHOST with Casper FFG filtering), written against
//! consensus-specs v1.7.0-beta.4 `specs/*/fork-choice.md`, plus the fast confirmation
//! rule from `specs/*/fast-confirmation.md`.
//!
//! `Store` mirrors the spec `Store` minus the beacon states: states stay with the
//! caller, which hands the fork choice the facts it needs (post-state checkpoints,
//! indexed attestations, committees) through the handler arguments and
//! `StateProvider`. Every spec helper keeps its name in camelCase so the two can
//! be read side by side.

const std = @import("std");

pub const store = @import("store.zig");
pub const head = @import("head.zig");
pub const proposer_head = @import("proposer_head.zig");
pub const vote_targets = @import("vote_targets.zig");
pub const fast_confirmation = @import("fast_confirmation.zig");

pub const Store = store.Store;
pub const Error = store.Error;
pub const ForkChoiceNode = store.ForkChoiceNode;
pub const ExecutionStatus = store.ExecutionStatus;
pub const PayloadStatus = store.PayloadStatus;
pub const BlockIndex = store.BlockIndex;
pub const Checkpoint = store.Checkpoint;
pub const LatestMessage = store.LatestMessage;
pub const TargetId = vote_targets.TargetId;
pub const JustifiedBalances = store.JustifiedBalances;
pub const StateProvider = store.StateProvider;
pub const BalanceSource = store.BalanceSource;
pub const FastConfirmation = fast_confirmation.FastConfirmation;
pub const ViableHead = head.ViableHead;
pub const PtcVote = store.PtcVote;

test {
    std.testing.refAllDecls(@This());
}
