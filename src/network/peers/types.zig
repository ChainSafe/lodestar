const PeerOrigin = @import("../types.zig").PeerOrigin;
const identify_mod = @import("../identify/root.zig");
const custody = @import("custody.zig");
pub const PeerId = @import("../wire/peer_id.zig").PeerId;
pub const Handle = @import("../types.zig").Handle;
pub const Direction = @import("../types.zig").Direction;
pub const Address = @import("../types.zig").Address;
pub const CloseReason = @import("../types.zig").CloseReason;
pub const ForkSeq = @import("config").ForkSeq;
pub const PeerRef = @import("../types.zig").PeerRef;
pub const Status = @import("../local_state.zig").Status;
pub const Metadata = @import("../local_state.zig").Metadata;
pub const ForkContext = @import("../local_state.zig").ForkContext;
pub const LocalState = @import("../local_state.zig").LocalState;
pub const PeerAction = enum { fatal, low_tolerance, mid_tolerance, high_tolerance };
pub const PeerReport = struct {
    identity: PeerId,
    action: PeerAction,
    origin: ?PeerOrigin = null,
    reason: Reason = .host,

    pub const Reason = enum { host, gossip_validation, gossip_import, gossip_receive_timeout, reqresp_protocol, reqresp_response };
};
pub const ReputationDecision = enum { none, disconnect, ban };
pub const DisconnectReason = enum {
    host,
    shutdown,
    transport_closed,
    capacity,
    incompatible_fork,
    future_head,
    finalized_mismatch,
    missing_availability,
    invalid_status,
    invalid_metadata,
    remote_goodbye,
    health_timeout,
    reputation,
    banned,
    count_pruning,
    gossip_unavailable,
    gossip_send_timeout,
    health_error,
};
/// `health` is a peer-charged health close of a connection to the endpoint; no dial attempt ends with it.
pub const DialFailure = enum { unanswered, handshake_timeout, peer_id_mismatch, refused, destination_unreachable, expired, health };
pub const DialOutcome = enum { connected, deferred, admission_refused, cancelled, unanswered, handshake_timeout, peer_id_mismatch, refused, destination_unreachable, expired };
/// How a remote refused us, recorded against its identity. `banned` covers every lasting exclusion:
/// a bad score, a ban, or an irrelevant network. `early_close` is a remote close of our dial, or its
/// refusal of our Status, before the Status and Metadata exchange completed.
pub const Rejection = enum { shutdown, fault, early_close, too_many_peers, banned };
pub const Snapshot = struct {
    identify: ?identify_mod.Metadata = null,
    peer: PeerRef,
    identity: PeerId,
    connection: ?Handle,
    direction: Direction,
    endpoint: Address,
    relevant: bool,
    disconnect_reason: ?DisconnectReason = null,
    status: ?Status,
    metadata: ?Metadata,
    status_at_ms: u64,
    metadata_at_ms: u64,
    custody_groups: ?custody.Groups = null,
    sampling_groups: ?custody.Groups = null,
    connected_at_ms: u64,
    direct: bool,
    score: f64,
    score_at_ms: u64 = 0,
    ban_until_ms: u64,
    goodbye_until_ms: u64,
    redial_until_ms: u64 = 0,
};
pub const Event = union(enum) {
    ready: Snapshot,
    updated: Snapshot,
    closed: struct {
        peer: PeerRef,
        identity: PeerId,
        connection: Handle,
        reason: DisconnectReason,
    },
};

pub const Coverage = struct {
    attnets: u64 = 0,
    syncnets: u4 = 0,
    groups: custody.Groups = .empty,
    custody_groups: custody.Groups = .empty,
};
/// Desired coverage persists until replacement; the application owns validator duty expiry.
pub const Demand = struct {
    attnets: u64 = 0,
    syncnets: u4 = 0,
    group_targets: [128]u16 = @splat(0),
    custody_group_targets: [128]u16 = @splat(0),
    attestation_target: u16 = 1,
    sync_target: u16 = 1,

    pub fn wanted(self: *const Demand) Coverage {
        var result: Coverage = .{ .attnets = self.attnets, .syncnets = self.syncnets };
        for (self.group_targets, 0..) |target, index| if (target > 0) {
            result.groups.set(index);
        };
        for (self.custody_group_targets, 0..) |target, index| if (target > 0) {
            result.custody_groups.set(index);
        };
        return result;
    }

    pub fn validate(self: *const Demand, context: *const ForkContext, max_peers: u16) !void {
        try context.validate();
        if (max_peers == 0 or max_peers > 256 or self.attestation_target == 0 or
            self.sync_target == 0 or self.attestation_target > max_peers or
            self.sync_target > max_peers) return error.InvalidDemand;
        for (self.group_targets, self.custody_group_targets, 0..) |gossip_target, custody_target, index| {
            if (@max(gossip_target, custody_target) > max_peers or
                (index >= context.custody_groups and (gossip_target != 0 or custody_target != 0)) or
                (!context.fork.gte(.fulu) and custody_target != 0))
                return error.InvalidDemand;
        }
    }
};

test {
    _ = @import("types_test.zig");
}
