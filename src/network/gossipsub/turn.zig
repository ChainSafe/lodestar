const constants = @import("constants.zig");
const Options = @import("options.zig").Options;
const std = @import("std");
const Now = @import("../types.zig").Now;
const MessageSink = @import("messages.zig").MessageSink;
pub const Budget = enum { calls, input, output, items, fields, work, copy };
pub const budget_count = @typeInfo(Budget).@"enum".fields.len;
pub const Budgets = std.EnumSet(Budget);

pub const Progress = enum { done, credits };

pub const Credits = struct {
    input: usize,
    output: usize,
    items: usize,
    calls: usize,
    work: usize,
    copy: usize,
    fields: usize,

    pub fn peer(options: *const Options) Credits {
        return .{
            .input = options.input_per_peer,
            .output = options.output_per_peer,
            .items = options.items_per_peer,
            .calls = options.calls_per_peer,
            .work = options.decompress_per_peer_bytes,
            .copy = options.decompress_per_peer_bytes,
            .fields = constants.fields_per_peer,
        };
    }
};

pub const Turn = struct {
    now: Now,
    budget: Credits,
    scratch: []u8,
    large_used: bool = false,
    large_copy_used: bool = false,
    sink: ?*const MessageSink = null,
    deferred: Budgets = .empty,

    pub fn exhausted(self: *const Turn) Budgets {
        var result = self.deferred;
        inline for (std.meta.fields(Budget)) |field| {
            if (@field(self.budget, field.name) == 0) result.insert(@enumFromInt(field.value));
        }
        return result;
    }

    pub fn init(options: *const Options, now: Now, scratch: []u8) Turn {
        return .{
            .now = now,
            .budget = .{
                .input = options.input_per_pump,
                .output = options.output_per_pump,
                .items = options.items_per_pump,
                .calls = options.calls_per_pump,
                .work = options.work_per_pump,
                .copy = options.work_per_pump,
                .fields = constants.fields_per_pump,
            },
            .scratch = scratch,
        };
    }

    pub fn chargeCopy(self: *Turn, peer: *Credits, options: *const Options, bytes: usize) bool {
        if (bytes <= self.budget.copy and bytes <= peer.copy) {
            self.budget.copy -= bytes;
            peer.copy -= bytes;
            return true;
        }
        if (!self.large_copy_used and bytes > @min(options.work_per_pump, options.decompress_per_peer_bytes)) {
            self.large_copy_used = true;
            return true;
        }
        if (bytes > self.budget.copy) self.deferred.insert(.copy);
        return false;
    }

    pub fn workspace(self: *Turn, peer: *Credits) Workspace {
        return .{ .scratch = self.scratch, .peer_work = &peer.work, .work = &self.budget.work, .large_used = &self.large_used, .sink = self.sink, .deferred = &self.deferred };
    }
};

pub const Workspace = struct {
    scratch: []u8,
    peer_work: *usize,
    work: *usize,
    large_used: *bool,
    sink: ?*const MessageSink = null,
    deferred: ?*Budgets = null,

    pub fn charge(workspace: *const Workspace, options: *const Options, compressed: usize, decoded: usize) bool {
        return workspace.chargeWork(options, compressed * 2 + decoded * 2);
    }

    pub fn chargeWork(workspace: *const Workspace, options: *const Options, cost: usize) bool {
        if (cost <= workspace.work.* and cost <= workspace.peer_work.*) {
            workspace.work.* -= cost;
            workspace.peer_work.* -= cost;
            return true;
        }
        if (!workspace.large_used.* and cost > @min(options.work_per_pump, options.decompress_per_peer_bytes)) {
            workspace.large_used.* = true;
            return true;
        }
        if (cost > workspace.work.*) if (workspace.deferred) |deferred| deferred.insert(.work);
        return false;
    }
};
