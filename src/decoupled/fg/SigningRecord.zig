//! Durable validator record Lambda, fgsa-spec.pdf Section 2.3 and Figure 4.
//! Keep this object across restarts. Persist a successful update before broadcasting its result.
//! This module reads no FG state, clock, storage device, or network.
const std = @import("std");
const assert = std.debug.assert;
const BoundedArray = @import("bounded_array").BoundedArray;
const limits = @import("../limits.zig");
const types = @import("../types.zig");
const fg = @import("finality_types.zig");

const SigningRecord = @This();
const Root = fg.Root;
const Height = fg.Height;
pub const Error = error{ InvalidInput, HeightCapacity, SentCapacity };

/// Validator identity used for generated attestations; fixed for this record's lifetime.
val_index: types.ValidatorIndex,
/// First target sent at height h. Null for bottom.
target: [limits.max_heights]?Root,
/// Whether this validator sent a timeout at height h.
timeout: [limits.max_heights]bool,
/// Target of the validator's first finality pair at height h.
lock: [limits.max_heights]?Root,
/// Lambda.sent: all sent contents, with no age eviction or per-height truncation.
sent: BoundedArray(fg.Attestation, limits.max_sent_attestations),

/// Figure 3's FG_ATTEST supplies these scalar inputs, without exposing Sigma to the client.
pub const Input = fg.AttestationInput;
const FinalityPair = struct { h_f: ?Height = null, T_f: ?Root = null };
const HeightPair = struct { h: Height, T: Root, tau: bool };

/// Section 2.3 (p. 7): initialize target/lock to bottom, timeout to false, and sent to empty.
pub fn init(self: *SigningRecord, options: struct { n: u32, val_index: u32 }) Error!void {
    if (options.n == 0 or options.n > limits.max_validators or options.val_index >= options.n) {
        return error.InvalidInput;
    }
    self.val_index = options.val_index;
    self.target = @splat(null);
    self.timeout = @splat(false);
    self.lock = @splat(null);
    self.sent = .{};
}

/// Figure 4, lines 19-29. A null result sends nothing and leaves Lambda unchanged.
/// All capacity/input failures also leave Lambda unchanged. The caller signs the returned tuple.
pub fn createAttestation(self: *SigningRecord, input: *const Input) Error!?fg.Attestation {
    if ((input.h_c == null) != (input.T_c == null)) return error.InvalidInput;
    if (input.h_F > input.h_j) return error.InvalidInput;
    if (input.h_j >= limits.max_heights) return error.HeightCapacity;
    if (input.h_c) |h_c| {
        if (h_c == 0) return error.InvalidInput;
        if (h_c >= limits.max_heights) return error.HeightCapacity;
    }
    var finality_pair = self.finalityPair(input);
    const height_pair = self.heightPair(input, &finality_pair) orelse return null;
    for (self.sent.constSlice()) |*b| {
        if (b.h == height_pair.h and
            (!height_pair.tau or rootsEqual(&b.T, &height_pair.T))) return null;
    }
    if (finality_pair.h_f) |h_f| {
        if (height_pair.h <= h_f) finality_pair = .{};
    }
    const a: fg.Attestation = .{
        .val_index = self.val_index,
        .h = height_pair.h,
        .T = height_pair.T,
        .tau = height_pair.tau,
        .h_f = finality_pair.h_f,
        .T_f = finality_pair.T_f,
    };
    if (self.sent.full()) return error.SentCapacity;
    self.recordAttestation(&a);
    return a;
}

/// Figure 4, lines 1-5: attach an unfinalized justification only when all three records allow it.
fn finalityPair(self: *const SigningRecord, input: *const Input) FinalityPair {
    if (input.h_j <= input.h_F) return .{};
    const h_j = input.h_j;
    if (!unsetOrEqual(&self.target[h_j], &input.J) or self.timeout[h_j]) return .{};
    if (!unsetOrEqual(&self.lock[h_j], &input.J)) return .{};
    return .{ .h_f = h_j, .T_f = input.J };
}

/// Figure 4, lines 6-18: select a target/timeout entry.
/// Apply recorded locks and this attestation's own finality pair before selecting the entry.
fn heightPair(
    self: *const SigningRecord,
    input: *const Input,
    finality_pair: *const FinalityPair,
) ?HeightPair {
    const h_c = input.h_c orelse return null;
    const T_c = input.T_c.?;
    var lock = self.lock[h_c];
    if (finality_pair.h_f == h_c) lock = finality_pair.T_f;
    if (self.timeout[h_c]) return .{ .h = h_c, .T = T_c, .tau = true };
    if (lock) |T| {
        if (rootsEqual(&T, &T_c)) return .{ .h = h_c, .T = T_c, .tau = false };
        return null;
    }
    return .{ .h = h_c, .T = T_c, .tau = !unsetOrEqual(&self.target[h_c], &T_c) };
}

/// Figure 4, lines 30-39: the only post-initialization writer of Lambda's protocol fields.
fn recordAttestation(self: *SigningRecord, a: *const fg.Attestation) void {
    assert(a.h < limits.max_heights);
    assert(!self.sent.full());
    self.sent.push(a.*);
    if (a.T_f) |T_f| self.lock[a.h_f.?] = T_f;
    if (!a.tau and self.target[a.h] == null) self.target[a.h] = a.T;
    if (a.tau) self.timeout[a.h] = true;
}

fn unsetOrEqual(value: *const ?Root, T: *const Root) bool {
    const held = value.* orelse return true;
    return rootsEqual(&held, T);
}

fn rootsEqual(a: *const Root, b: *const Root) bool {
    return std.mem.eql(u8, a, b);
}

test {
    _ = @import("signing_record_test.zig");
}
