const std = @import("std");
const ct = @import("consensus_types");
const ForkSeq = @import("config").ForkSeq;
const test_case = @import("../test_case.zig");
const loadSszValue = test_case.loadSszSnappyValue;
const hex = @import("hex");
const ssz = @import("ssz");

const pmt = @import("persistent_merkle_tree");
const Node = pmt.Node;
const Gindex = pmt.Gindex;

pub const Handler = enum {
    single_merkle_proof,

    pub fn suiteName(self: Handler) []const u8 {
        return @tagName(self);
    }
};

const MerkleProof = struct {
    leaf: [66]u8,
    leaf_gindex: Gindex,
    branch: [][66]u8,

    pub fn deinit(self: *MerkleProof, allocator: std.mem.Allocator) void {
        allocator.free(self.branch);
    }
};

pub fn TestCase(comptime fork: ForkSeq) type {
    const ForkTypes = @field(ct, fork.name());
    const BeaconBlockBody = ForkTypes.BeaconBlockBody;
    const KzgCommitment = ct.primitive.KZGCommitment;

    return struct {
        body: BeaconBlockBody.Type,
        expect_proof: MerkleProof,
        actual_proof: MerkleProof,
        allocator: std.mem.Allocator,

        const Self = @This();

        pub fn execute(allocator: std.mem.Allocator, dir: std.Io.Dir) !void {
            var tc = try Self.init(allocator, dir);
            defer tc.deinit();

            try tc.runTest();
        }

        fn init(allocator: std.mem.Allocator, dir: std.Io.Dir) !Self {
            var body = BeaconBlockBody.default_value;
            errdefer {
                if (comptime @hasDecl(BeaconBlockBody, "deinit")) {
                    BeaconBlockBody.deinit(allocator, &body);
                }
            }
            try loadSszValue(BeaconBlockBody, allocator, dir, "object.ssz_snappy", &body);

            var proof_data: MerkleProof = undefined;
            try loadProof(allocator, dir, &proof_data);

            return .{
                .body = body,
                .expect_proof = proof_data,
                .actual_proof = undefined,
                .allocator = allocator,
            };
        }

        fn deinit(self: *Self) void {
            self.expect_proof.deinit(self.allocator);
            self.actual_proof.deinit(self.allocator);
            if (comptime @hasDecl(BeaconBlockBody, "deinit")) {
                BeaconBlockBody.deinit(self.allocator, &self.body);
            }
        }

        fn runTest(self: *Self) !void {
            try self.process();
            try expectEqualProof(&self.expect_proof, &self.actual_proof);
        }

        fn process(self: *Self) !void {
            const is_fulu = fork == .fulu;
            const gindex = if (is_fulu)
                ssz.getPathGindex(BeaconBlockBody, "blob_kzg_commitments")
            else
                ssz.getPathGindex(BeaconBlockBody, "blob_kzg_commitments.0");

            var actual_leaf: [32]u8 = undefined;
            if (is_fulu) {
                try ct.deneb.BlobKzgCommitments.hashTreeRoot(self.allocator, &self.body.blob_kzg_commitments, &actual_leaf);
            } else {
                try KzgCommitment.hashTreeRoot(&self.body.blob_kzg_commitments.items[0], &actual_leaf);
            }

            var pool = try Node.Pool.init(.{ .page_allocator = self.allocator, .allocator = self.allocator, .pool_size = 40_960 });
            defer pool.deinit();

            const root_node = try BeaconBlockBody.tree.fromValue(&pool, &self.body);
            defer pool.unref(root_node);

            var single_proof = try pmt.proof.createSingleProof(self.allocator, &pool, root_node, gindex);
            defer single_proof.deinit(self.allocator);
            self.actual_proof = try buildActualProof(self.allocator, gindex, &actual_leaf, single_proof.witnesses);
        }

        fn buildActualProof(
            allocator: std.mem.Allocator,
            leaf_gindex: Gindex,
            leaf_bytes: *const [32]u8,
            witnesses: [][32]u8,
        ) !MerkleProof {
            var branch = try allocator.alloc([66]u8, witnesses.len);
            errdefer allocator.free(branch);

            for (witnesses, 0..) |witness, i| {
                branch[i] = try hex.rootToHex(&witness);
            }

            return .{
                .leaf = try hex.rootToHex(leaf_bytes),
                .leaf_gindex = leaf_gindex,
                .branch = branch,
            };
        }

        fn expectEqualProof(
            expected: *const MerkleProof,
            actual: *const MerkleProof,
        ) !void {
            try std.testing.expectEqual(expected.leaf_gindex, actual.leaf_gindex);
            try std.testing.expectEqualSlices(u8, expected.leaf[0..66], actual.leaf[0..66]);
            try std.testing.expectEqual(expected.branch.len, actual.branch.len);
            for (expected.branch, 0..) |expected_witness, i| {
                try std.testing.expectEqualSlices(u8, expected_witness[0..66], actual.branch[i][0..66]);
            }
        }

        fn loadProof(allocator: std.mem.Allocator, dir: std.Io.Dir, out: *MerkleProof) !void {
            const contents = try dir.readFileAlloc(std.testing.io, "proof.yaml", allocator, .unlimited);
            defer allocator.free(contents);

            out.* = try parseProofYaml(allocator, contents);
        }

        fn parseProofYaml(allocator: std.mem.Allocator, contents: []const u8) !MerkleProof {
            var branch: std.ArrayList([66]u8) = .empty;
            errdefer branch.deinit(allocator);
            var leaf: ?[66]u8 = null;
            var leaf_gindex: ?Gindex = null;

            var iter = std.mem.tokenizeScalar(u8, contents, '\n');
            const quote = "'\"";
            while (iter.next()) |line| {
                if (line.len == 0) continue;

                if (std.mem.startsWith(u8, line, "leaf: ")) {
                    const value_slice = std.mem.trim(u8, line["leaf: ".len..], quote);
                    std.debug.assert(value_slice.len == 66);
                    leaf = value_slice[0..66].*;
                } else if (std.mem.startsWith(u8, line, "leaf_index: ")) {
                    const value_slice = std.mem.trim(u8, line["leaf_index: ".len..], quote);
                    leaf_gindex = Gindex.fromUint(try std.fmt.parseInt(Gindex.Uint, value_slice, 10));
                } else if (std.mem.startsWith(u8, line, "- ")) {
                    const value_slice = std.mem.trim(u8, line[2..], quote);
                    std.debug.assert(value_slice.len == 66);
                    const branch_value = value_slice[0..66].*;
                    try branch.append(allocator, branch_value);
                }
            }

            if (leaf == null or leaf_gindex == null) {
                return error.InvalidProof;
            }

            const expected_branch_len: usize = @intCast(leaf_gindex.?.pathLen());
            if (branch.items.len != expected_branch_len) {
                return error.InvalidProof;
            }

            return .{
                .leaf = leaf.?,
                .leaf_gindex = leaf_gindex.?,
                .branch = try branch.toOwnedSlice(allocator),
            };
        }
    };
}
