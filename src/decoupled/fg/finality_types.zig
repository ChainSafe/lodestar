//! FG value types from fgsa-spec.pdf Sections 1.2 and 2.1.
//! Roots identify immutable blocks. Signatures, digest verification, and encoding belong to Node.
const std = @import("std");
const limits = @import("../limits.zig");
const types = @import("../types.zig");
const Frame = @import("FinalityFrame.zig");

pub const Height = u32;
pub const Root = types.Root;

pub const Config = struct {
    /// Root of B_gen, the supplied genesis block from Section 1.3 (p. 3).
    B_gen: Root,
    /// Size of the fixed, unit-weight validator set V; Section 1.1 requires n >= 1.
    n: u32,
    /// Maximum number of pending justified height-target pairs retained per chain; K_W >= 2.
    /// When the window is full, retain the newest pairs (Section 2.1).
    K_W: u32,
    /// Minimum target age in slots before a progress quorum can advance height by timeout.
    /// Age is measured from T_h.slot. Zero permits timeout progress without an added delay.
    delta_t: types.Slot,

    /// Sections 1.1 and 2.1 require n >= 1 and K_W >= 2. The n upper bound is storage-only.
    pub fn valid(self: *const Config) bool {
        return self.n >= 1 and self.n <= limits.max_validators and self.K_W >= 2;
    }

    /// Section 1.1 (p. 2): q = ceil(2*n/3) for unit weights.
    pub fn quorum(self: *const Config) u32 {
        std.debug.assert(self.valid());
        return (2 * self.n + 2) / 3;
    }
};

/// An immutable block reference. The slot belongs to this root in the FG-owned tree.
pub const BlockRef = struct {
    root: Root,
    slot: types.Slot,
};

/// The projection of sigma[B] that the store reads (Figure 3, lines 16-21 and 35-36).
/// The state transition owns the participation and pending-finality fields it is built from.
pub const BlockSummary = struct {
    h: Height,
    T_h: BlockRef,
    h_j: Height,
    J: BlockRef,
    h_F: Height,
    F: BlockRef,

    /// Section 2.1 invariant h_F <= h_j < h.
    pub fn valid(self: *const BlockSummary) bool {
        return self.h_F <= self.h_j and self.h_j < self.h;
    }
};

/// Figure 3's FG_ATTEST inputs: the confirmed block's height entry and the head's finality view.
pub const AttestationInput = struct {
    h_c: ?Height,
    T_c: ?Root,
    h_j: Height,
    J: Root,
    h_F: Height,
};

/// Section 2.1 (p. 5): a = (val_index, h, T, tau, h_f, T_f).
/// tau is the ASCII name of the target/timeout Boolean. null represents bottom, not a zero root.
pub const Attestation = struct {
    val_index: types.ValidatorIndex,
    h: Height,
    T: Root,
    tau: bool,
    h_f: ?Height = null,
    T_f: ?Root = null,

    /// Section 2.1's wire shape, plus membership in V. This does not check a signature.
    pub fn valid(self: *const Attestation, n: u32) bool {
        if (self.val_index >= n or self.h == 0) return false;
        if ((self.h_f == null) != (self.T_f == null)) return false;
        if (self.h_f) |h_f| return h_f < self.h;
        return true;
    }

    pub fn eql(a: *const Attestation, b: *const Attestation) bool {
        return a.val_index == b.val_index and a.contentEql(b);
    }

    /// Lambda.sent records contents without the validator's fixed identity (Section 2.3).
    pub fn contentEql(a: *const Attestation, b: *const Attestation) bool {
        if (a.h != b.h or a.tau != b.tau or a.h_f != b.h_f) return false;
        if (!std.mem.eql(u8, &a.T, &b.T)) return false;
        if (a.T_f) |T_f| {
            const other = b.T_f orelse return false;
            return std.mem.eql(u8, &T_f, &other);
        }
        return b.T_f == null;
    }
};

/// Borrowed full block input. FG copies all lists on acceptance, preserving order and repetitions.
/// Node must verify the root, block/attestation signatures, and AC payload before FG admission.
pub const Block = struct {
    root: Root,
    slot: types.Slot,
    parent: Root,
    proposer: types.ValidatorIndex,
    ac_payload: Frame.Payload = .{},
    attestations: []const Attestation = &.{},

    pub fn ref(self: *const Block) BlockRef {
        return .{ .root = self.root, .slot = self.slot };
    }
};

test {
    _ = @import("finality_types_test.zig");
}
