//! Sigma.attestations, fgsa-spec.pdf Section 1.3 and Figure 3, lines 10-11 and 44-45.
//! Validator-side state: it feeds FG_PROPOSE and never influences the store's caches.
//! Node verifies signature, wire shape, and membership before any call here.
//! Pool overflow never evicts existing attestations; exhaustion ends a run.
const std = @import("std");
const assert = std.debug.assert;
const BoundedArray = @import("bounded_array").BoundedArray;
const limits = @import("../limits.zig");
const fg = @import("finality_types.zig");

const AttestationPool = @This();
pub const Error = error{AttestationCapacity};
pub const List = BoundedArray(fg.Attestation, limits.max_attestations_per_block);

/// All processed attestations, deduplicated in first-acceptance order.
entries: BoundedArray(fg.Attestation, limits.max_attestations),

pub fn init(self: *AttestationPool) void {
    self.entries = .{};
}

/// Figure 3, lines 10-11. Return false for an exact duplicate.
pub fn add(self: *AttestationPool, a: *const fg.Attestation) Error!bool {
    if (self.contains(a)) return false;
    if (self.entries.full()) return error.AttestationCapacity;
    self.entries.push(a.*);
    return true;
}

/// Room for every new distinct row of a block. Check before the block is accepted anywhere.
pub fn checkCapacity(self: *const AttestationPool, attestations: []const fg.Attestation) Error!void {
    var needed: u32 = 0;
    for (attestations, 0..) |*a, index| {
        if (self.contains(a)) continue;
        var repeated = false;
        for (attestations[0..index]) |*previous| {
            if (previous.eql(a)) {
                repeated = true;
                break;
            }
        }
        if (!repeated) needed += 1;
    }
    if (needed > limits.max_attestations - self.entries.count) return error.AttestationCapacity;
}

/// Pool the attestations carried by an accepted block, after checkCapacity passed for that list.
pub fn absorb(self: *AttestationPool, attestations: []const fg.Attestation) void {
    for (attestations) |*a| {
        if (self.contains(a)) continue;
        assert(!self.entries.full());
        self.entries.push(a.*);
    }
}

pub fn contains(self: *const AttestationPool, a: *const fg.Attestation) bool {
    for (self.entries.constSlice()) |*held| {
        if (held.eql(a)) return true;
    }
    return false;
}

/// Figure 3, lines 44-45: keep pool order and select the rows context.eligible admits.
/// Capacity failure leaves out unchanged; a block must not silently omit eligible rows.
pub fn select(self: *const AttestationPool, context: anytype, out: *List) Error!void {
    var count: u32 = 0;
    for (self.entries.constSlice()) |*a| {
        if (context.eligible(a)) count += 1;
    }
    if (count > limits.max_attestations_per_block) return error.AttestationCapacity;
    out.* = .{};
    for (self.entries.constSlice()) |*a| {
        if (context.eligible(a)) out.push(a.*);
    }
}

test {
    _ = @import("attestation_pool_test.zig");
}
