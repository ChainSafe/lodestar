//! NAPI bindings for EIP-8025 execution proof verification.
//!
//! Verifiers register once per proof type and live until the last environment
//! unloads, so a verification running on the libuv pool never races a free.
const std = @import("std");
const zapi = @import("zapi:zapi");
const js = zapi.js;
const napi = zapi.napi;
const Verifier = @import("ere_verifier").Verifier;

/// Mirrors `ere_verifier_new`'s discriminants.
///
/// Source: https://github.com/eth-act/ere/blob/332d8b1206a85b111b4051d2f8e7162ed3b3bb33/bindings/c/src/lib.rs#L27-L32
pub const ZkvmKind = enum(u32) {
    openvm = 0,
    sp1 = 1,
    zisk = 2,
    lambdavm = 3,
};

/// EIP-8025 `MAX_PROOF_SIZE`.
///
/// Spec: https://github.com/ethereum/consensus-specs/blob/a06852f7fad3d6c4557808f48ad7a32ed7cbf996/specs/_features/eip8025/beacon-chain.md#L74
pub const MAX_PROOF_SIZE: u32 = @intCast(Verifier.max_proof_bytes);

/// False on targets without a prebuilt ere verifier library.
pub const available: bool = Verifier.available;

/// The identifier of the proof system, guest program, and version associated with an execution proof.
///
/// Spec: https://github.com/ethereum/consensus-specs/blob/a06852f7fad3d6c4557808f48ad7a32ed7cbf996/specs/_features/eip8025/beacon-chain.md#new-prooftype
const ProofType = u8;

const State = struct {
    verifiers: [std.math.maxInt(ProofType) + 1]?Verifier = @splat(null),

    pub fn deinit(self: *State) void {
        for (&self.verifiers) |*slot| {
            if (slot.*) |*verifier| verifier.deinit();
            slot.* = null;
        }
    }
};

pub var state: State = .{};

fn proofTypeIndex(proof_type: js.Number) !ProofType {
    return std.math.cast(ProofType, try proof_type.toU32Exact()) orelse error.InvalidProofType;
}

fn zkvmKindFromNumber(zkvm_kind: js.Number) !Verifier.ZkvmKind {
    return switch (try zkvm_kind.toU32Exact()) {
        @intFromEnum(ZkvmKind.openvm) => .openvm,
        @intFromEnum(ZkvmKind.sp1) => .sp1,
        @intFromEnum(ZkvmKind.zisk) => .zisk,
        @intFromEnum(ZkvmKind.lambdavm) => .lambdavm,
        else => error.InvalidZkvmKind,
    };
}

/// Binds `proof_type` to a verifier for `zkvm_kind` and `program_vk`, once per
/// process. Throws when the proof type is already registered, the kind is
/// unknown, or the key does not decode.
pub fn register(proof_type: js.Number, zkvm_kind: js.Number, program_vk: js.Uint8Array) !void {
    const index = try proofTypeIndex(proof_type);
    if (state.verifiers[index] != null) return error.ProofTypeAlreadyRegistered;

    const kind = try zkvmKindFromNumber(zkvm_kind);
    state.verifiers[index] = try Verifier.init(kind, try program_vk.toSlice());
}

pub fn has(proof_type: js.Number) !js.Boolean {
    return js.Boolean.from(state.verifiers[try proofTypeIndex(proof_type)] != null);
}

const VerifyTask = struct {
    verifier: *const Verifier,
    proof: []u8,
    public_values: [Verifier.max_public_values_bytes]u8 = undefined,
    /// Null until a proof verifies; the task is heap-resident, so reslicing
    /// `public_values` by length avoids a self-referential pointer.
    public_values_len: ?usize = null,

    pub fn compute(self: *VerifyTask) !void {
        const public_values = self.verifier.verify(&self.public_values, self.proof) catch |err| switch (err) {
            error.DecodeProof, error.Verify => return,
            else => return err,
        };
        self.public_values_len = public_values.len;
    }

    pub fn resolve(self: *VerifyTask, env: napi.Env) !napi.Value {
        const len = self.public_values_len orelse return env.getNull();

        var owned: js.OwnedUint8Array = try .fromSlice(js.allocator(), self.public_values[0..len]);
        defer owned.deinit();

        return owned.intoValue(env);
    }

    pub fn deinit(self: *VerifyTask) void {
        js.allocator().free(self.proof);
    }
};

/// Verifies `proof_data` on the libuv pool with the verifier registered for
/// `proof_type`.
///
/// The promise resolves with the public values the proof commits to, or null
/// when the proof is malformed or does not verify, and rejects on an internal
/// verifier failure.
///
/// Throws for an unregistered proof type or an oversized proof.
pub fn verify(proof_type: js.Number, proof_data: js.Uint8Array) !js.Value {
    const slot = &state.verifiers[try proofTypeIndex(proof_type)];
    const verifier: *const Verifier = if (slot.*) |*entry| entry else return error.ProofTypeNotRegistered;

    const proof = try proof_data.toSlice();
    if (proof.len > Verifier.max_proof_bytes) return error.ProofTooLarge;

    const copy = try js.allocator().dupe(u8, proof);
    errdefer js.allocator().free(copy);

    return js.spawn(VerifyTask, .{ .verifier = verifier, .proof = copy }, "executionProofVerifier.verify");
}
