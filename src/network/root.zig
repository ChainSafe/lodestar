//! A serialized owner advances bounded protocol state machines. Engines own protocol
//! machinery; transports connect engines to sockets; drivers wait for readiness and
//! advance with fresh time. NetworkCore coordinates discovery, peer policy and Protocols.
//! The binding runtime owns the execution environment and host delivery.
//!
//! Scheduling vocabulary:
//! - Schedule describes immediate work and the earliest deadline. It owns no work.
//! - Turn is one bounded execution opportunity; Pass traverses a defined set of work.
//! - Cycle is a logical maintenance operation that may span turns.
//! - step performs one driver iteration, including waiting; advance uses supplied input
//!   and time; pump services pending work until blocked or limited by its budget.
//!
//! Decisions and configuration:
//! - Intent describes desired state; Demand gives targets; Hints are advisory inputs.
//! - State records execution; Selection names chosen work. A SelectedDial carries a
//!   reservation, so its owner must report the attempt's disposition.
//! - Options are construction inputs, Resolved contains derived settings, and Config
//!   holds enduring configuration. Options may contain required fields.
//! - Layout describes storage sizes and offsets. Plan describes a proposed operation;
//!   Prepared values belong to a preparation/commit contract documented by their owner.
//!
//! Storage and delivery:
//! - Table emphasizes indexed entries; Catalog retains identity knowledge; Registry
//!   tracks live instances; Pool manages reusable capacity; Store retains payloads.
//! - Slot names a reusable position, Entry its contents, and Record a domain value or
//!   bookkeeping object. A generational Handle identifies an incarnation of a slot.
//! - Result is an operation's return value; Outcome its disposition; Progress records
//!   advancement and continuation; Event reports a fact; Completion answers a pending
//!   operation or stage. A completion need not end its enclosing stream or host task.
//!
//! Qualify names at domain boundaries. Protocol and JavaScript terminology keeps its
//! domain meaning, including consensus slots and epochs and Promise settlement.

pub const gossip_processor = @import("gossip_processor/root.zig");
pub const index_list = @import("index_list.zig");
pub const chain = @import("chain.zig");
pub const application_policy = @import("application_policy.zig");
pub const SlotClock = @import("slot_clock.zig").SlotClock;
pub const application_state = @import("application_state.zig");
pub const configuration = @import("configuration.zig");
pub const metrics = @import("metrics/export.zig");
pub const logging = @import("logging.zig");
pub const stream_trace = @import("stream_trace.zig");
pub const xray = @import("xray/probe.zig");
pub const identify = @import("identify/root.zig");
pub const capabilities = @import("capabilities.zig");
pub const peer_manager = @import("peer_manager.zig");
pub const PeerManager = peer_manager.PeerManager;
pub const NetworkCore = @import("network_core.zig").NetworkCore;
pub const transport_driver = @import("transport_driver.zig");
pub const driver = @import("driver.zig");
pub const Schedule = types.Schedule;
pub const peers = @import("peers/root.zig");
pub const advertisement = @import("advertisement.zig");
pub const local_state = @import("local_state.zig");
pub const control_wire = @import("control_wire.zig");
pub const constants = @import("constants.zig");
pub const types = @import("types.zig");
pub const time = @import("time.zig");
pub const wire = @import("wire/root.zig");
pub const quic = @import("quic/root.zig");
pub const tls = @import("tls/root.zig");
pub const udp = @import("udp");
pub const protocol = @import("protocol.zig");
pub const Router = @import("router.zig").Router;
pub const Protocols = @import("protocols.zig").Protocols;
pub const stream_io = @import("stream_io.zig");
pub const reqresp = @import("reqresp/root.zig");
pub const gossipsub = @import("gossipsub/root.zig");

pub const Transport = @import("transport.zig").Transport;
pub const Negotiator = @import("negotiate.zig").Negotiator;
pub const Engine = quic.Engine;
pub const Handle = types.Handle;
pub const StreamHandle = types.StreamHandle;
pub const Event = quic.Engine.Event;
pub const Limits = quic.Engine.Limits;
pub const CloseReason = types.CloseReason;
pub const Now = types.Now;
pub const Address = types.Address;
pub const PeerId = wire.peer_id.PeerId;
pub const Multiaddr = wire.multiaddr.Multiaddr;
pub const KeyPair = wire.keys.KeyPair;

test {
    _ = xray;
    _ = @import("chain.zig");
    _ = gossip_processor;
    _ = peers;
    _ = local_state;
    _ = control_wire;
    _ = constants;
    _ = types;
    _ = wire;
    _ = quic;
    _ = tls;
    _ = udp;
    _ = Transport;
    _ = Negotiator;
    _ = stream_io;
    _ = reqresp;
    _ = gossipsub;
    _ = @import("wait.zig");
    _ = Router;
    _ = Protocols;
    _ = @import("network_core.zig");
    _ = driver;
    _ = transport_driver;
    _ = @import("counting_allocator.zig");
    _ = @import("deadline_heap.zig");
    _ = index_list;
    _ = configuration;
    _ = application_policy;
    _ = application_state;
    _ = @import("capabilities.zig");
    _ = identify;
    _ = metrics;
    _ = logging;
    _ = @import("metrics/histogram.zig");
    _ = @import("reqresp/metrics.zig");
}
