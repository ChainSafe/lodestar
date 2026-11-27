const std = @import("std");
const bls = @import("bls");

const PublicKey = bls.PublicKey;
const Signature = bls.Signature;
const SigningRoot = bls.SigningRoot;
const ThreadPool = bls.ThreadPool;
const BatchVerifyItem = bls.BatchVerifyItem;
const DST = bls.DST;

/// Bounded, allocation-free preparation and verification of signature sets.
/// The caller chooses the capacity appropriate for its input boundary.
pub fn SignatureSetBatch(comptime capacity: usize) type {
    if (capacity == 0) @compileError("signature set batch capacity must be positive");

    return struct {
        const Self = @This();

        count: usize = 0,
        messages: [capacity]SigningRoot = undefined,
        public_keys: [capacity]PublicKey = undefined,
        signatures: [capacity]Signature = undefined,

        /// Add a resolved public key and validate its signature. A false
        /// result is a cryptographic failure.
        pub fn append(
            self: *Self,
            public_key: *const PublicKey,
            message: *const SigningRoot,
            signature_bytes: []const u8,
        ) bool {
            std.debug.assert(self.count < capacity);

            const signature = Signature.sigValidate(signature_bytes, true) catch return false;

            self.messages[self.count] = message.*;
            self.public_keys[self.count] = public_key.*;
            self.signatures[self.count] = signature;
            self.count += 1;
            return true;
        }

        pub fn verify(self: *Self, io: std.Io, pool: *ThreadPool) !bool {
            std.debug.assert(self.count > 0);
            std.debug.assert(self.count <= capacity);

            var items: [capacity]BatchVerifyItem = undefined;
            for (0..self.count) |i| {
                items[i] = .{
                    .message = &self.messages[i],
                    .public_key = &self.public_keys[i],
                    .signature = &self.signatures[i],
                    .randomness = undefined,
                };
            }

            return bls.verifier.verifySignatureSets(
                io,
                pool,
                items[0..self.count],
                .{
                    .pks_validate = false,
                    .sigs_groupcheck = false,
                },
            );
        }
    };
}

/// Bounded, allocation-free verification for signatures sharing one message.
/// An aggregate check handles the common valid case; individual verification
/// identifies invalid signatures only when aggregation fails.
pub fn SameMessageSignatureSetBatch(comptime capacity: usize) type {
    if (capacity == 0) @compileError("same-message batch capacity must be positive");
    if (capacity > bls.MAX_AGGREGATE_PER_JOB) {
        @compileError("same-message batch capacity exceeds BLS aggregation limit");
    }

    return struct {
        const Self = @This();

        count: usize = 0,
        public_keys: [capacity]PublicKey = undefined,
        signatures: [capacity]Signature = undefined,
        signature_valid: [capacity]bool = undefined,
        can_aggregate: bool = true,

        pub fn append(
            self: *Self,
            public_key: *const PublicKey,
            signature_bytes: []const u8,
        ) void {
            std.debug.assert(self.count < capacity);

            self.public_keys[self.count] = public_key.*;

            if (Signature.sigValidate(signature_bytes, true)) |signature| {
                self.signatures[self.count] = signature;
                self.signature_valid[self.count] = true;
            } else |_| {
                self.signature_valid[self.count] = false;
                self.can_aggregate = false;
            }

            self.count += 1;
        }

        pub fn verify(
            self: *Self,
            io: std.Io,
            pool: *ThreadPool,
            message: *const SigningRoot,
            results: []bool,
        ) !void {
            std.debug.assert(self.count > 0);
            std.debug.assert(self.count <= capacity);
            std.debug.assert(results.len == self.count);

            if (self.can_aggregate) {
                var public_key_refs: [capacity]*const PublicKey = undefined;
                var signature_refs: [capacity]*const Signature = undefined;
                for (0..self.count) |i| {
                    public_key_refs[i] = &self.public_keys[i];
                    signature_refs[i] = &self.signatures[i];
                }

                if (try bls.verifier.verifySameMessage(
                    io,
                    pool,
                    public_key_refs[0..self.count],
                    signature_refs[0..self.count],
                    message,
                )) {
                    @memset(results, true);
                    return;
                }
            }

            for (0..self.count) |i| {
                results[i] = self.signature_valid[i] and blk: {
                    self.signatures[i].verify(
                        false,
                        message,
                        DST,
                        null,
                        &self.public_keys[i],
                        false,
                    ) catch break :blk false;
                    break :blk true;
                };
            }
        }
    };
}

test {
    _ = @import("verifier_test.zig");
}
