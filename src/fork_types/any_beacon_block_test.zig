//! Tests for `any_beacon_block.zig`.

const std = @import("std");
const AnySignedBeaconBlock = @import("any_beacon_block.zig").AnySignedBeaconBlock;
const expect = std.testing.expect;
const ct = @import("consensus_types");
const AnyBeaconBlock = @import("any_beacon_block.zig").AnyBeaconBlock;

test "Heze block wrappers preserve bid fields and reject legacy accessors" {
    const allocator = std.testing.allocator;
    var value = ct.heze.SignedBeaconBlock.default_value;
    value.message.slot = 17;
    value.message.body.signed_execution_payload_bid.message.block_hash = @splat(3);
    try value.message.body.signed_execution_payload_bid.message.inclusion_list_bits.set(15, true);
    const bytes = try allocator.alloc(u8, ct.heze.SignedBeaconBlock.serializedSize(&value));
    defer allocator.free(bytes);
    _ = ct.heze.SignedBeaconBlock.serializeIntoBytes(&value, bytes);

    var signed = try AnySignedBeaconBlock.deserialize(allocator, .full, .heze, bytes);
    defer signed.deinit(allocator);
    try std.testing.expectEqual(.heze, signed.forkSeq());
    try std.testing.expectEqual(.full, signed.blockType());
    const serialized = try signed.serialize(allocator);
    defer allocator.free(serialized);
    try std.testing.expectEqualSlices(u8, bytes, serialized);
    const block = signed.beaconBlock();
    try std.testing.expectEqual(17, block.slot());
    var expected: [32]u8 = undefined;
    var actual: [32]u8 = undefined;
    try ct.heze.BeaconBlock.hashTreeRoot(allocator, &value.message, &expected);
    try block.hashTreeRoot(allocator, &actual);
    try std.testing.expectEqualSlices(u8, &expected, &actual);
    const body = block.beaconBlockBody();
    try std.testing.expectEqualSlices(u8, &value.message.body.signed_execution_payload_bid.message.block_hash, try body.signedExecutionPayloadBidBlockHash());
    try std.testing.expectError(error.InvalidAtFork, body.eth1Data());
    try std.testing.expectError(error.InvalidAtFork, body.deposits());
    try std.testing.expectError(error.InvalidBlockTypeForFork, AnySignedBeaconBlock.deserialize(allocator, .blinded, .heze, bytes));
}

fn testBlockSanity(Block: type) !void {
    const allocator = std.testing.allocator;

    const ssz_block = ct.electra.BeaconBlock;
    var electra_block = ssz_block.default_value;

    electra_block.slot = 12345;
    electra_block.proposer_index = 1;
    electra_block.body.randao_reveal = [_]u8{1} ** 96;
    var attestations = try std.ArrayList(ct.electra.Attestation.Type).initCapacity(std.testing.allocator, 10);
    defer attestations.deinit(allocator);
    var attestation0 = ct.electra.Attestation.default_value;
    attestation0.data.slot = 12345;
    try attestations.append(allocator, attestation0);
    electra_block.body.attestations = attestations;
    try expect(electra_block.body.attestations.items[0].data.slot == 12345);

    const beacon_block = Block{ .full_electra = &electra_block };

    try expect(beacon_block.slot() == 12345);
    try expect(beacon_block.proposerIndex() == 1);
    try std.testing.expectEqualSlices(u8, &[_]u8{0} ** 32, beacon_block.parentRoot());
    try std.testing.expectEqualSlices(u8, &[_]u8{0} ** 32, beacon_block.stateRoot());

    var out: [32]u8 = undefined;
    // all phases
    try beacon_block.hashTreeRoot(allocator, &out);
    try expect(!std.mem.eql(u8, &[_]u8{0} ** 32, &out));
    const block_body = beacon_block.beaconBlockBody();
    try expect(block_body.forkSeq() == .electra);
    out = [_]u8{0} ** 32;
    try block_body.hashTreeRoot(allocator, &out);
    try expect(!std.mem.eql(u8, &[_]u8{0} ** 32, &out));

    try std.testing.expectEqualSlices(u8, &[_]u8{1} ** 96, block_body.randaoReveal());
    const eth1_data = try block_body.eth1Data();
    try expect(eth1_data.deposit_count == 0);
    try std.testing.expectEqualSlices(u8, &[_]u8{0} ** 32, block_body.graffiti());
    try expect(block_body.proposerSlashings().len == 0);
    try expect(block_body.attesterSlashings().length() == 0);
    try expect(block_body.attestations().length() == 1);
    try expect(block_body.attestations().items().electra[0].data.slot == 12345);
    try expect((try block_body.deposits()).len == 0);
    try expect(block_body.voluntaryExits().len == 0);

    // altair
    const sync_aggregate = try block_body.syncAggregate();
    try std.testing.expectEqualSlices(u8, &[_]u8{0} ** 96, &sync_aggregate.sync_committee_signature);

    try std.testing.expectEqualSlices(u8, &[_]u8{0} ** 32, (try block_body.executionPayload()).parentHash());

    // capella
    try expect((try block_body.blsToExecutionChanges()).len == 0);

    // deneb
    try expect((try block_body.blobKzgCommitments()).items.len == 0);

    // electra
    const execution_request = try block_body.executionRequests();
    try expect(execution_request.deposits.items.len == 0);
    try expect(execution_request.withdrawals.items.len == 0);
    try expect(execution_request.consolidations.items.len == 0);
}

test "electra - sanity" {
    try testBlockSanity(AnyBeaconBlock);
}

test "memory_safety: AnySignedBeaconBlock deserialize should deinit partial block on OOM" {
    const allocator = std.testing.allocator;
    const SignedBeaconBlock = ct.phase0.SignedBeaconBlock;

    var block = SignedBeaconBlock.default_value;
    defer SignedBeaconBlock.deinit(allocator, &block);

    try block.message.body.proposer_slashings.append(
        allocator,
        ct.phase0.ProposerSlashing.default_value,
    );
    try block.message.body.voluntary_exits.append(
        allocator,
        ct.phase0.SignedVoluntaryExit.default_value,
    );

    const bytes = try allocator.alloc(u8, SignedBeaconBlock.serializedSize(&block));
    defer allocator.free(bytes);
    _ = SignedBeaconBlock.serializeIntoBytes(&block, bytes);

    try std.testing.checkAllAllocationFailures(allocator, struct {
        fn run(failing_allocator: std.mem.Allocator, serialized: []const u8) !void {
            var decoded = try AnySignedBeaconBlock.deserialize(failing_allocator, .full, .phase0, serialized);
            defer decoded.deinit(failing_allocator);
        }
    }.run, .{bytes});
}
