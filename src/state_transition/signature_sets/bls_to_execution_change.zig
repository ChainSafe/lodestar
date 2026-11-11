const std = @import("std");
const types = @import("consensus_types");
const SignedBLSToExecutionChange = types.capella.SignedBLSToExecutionChange.Type;
const BeaconConfig = @import("config").BeaconConfig;
const SingleSignatureSet = @import("../utils/signature_sets.zig").SingleSignatureSet;
const c = @import("constants");
const bls = @import("bls");
const computeSigningRoot = @import("../utils/signing_root.zig").computeSigningRoot;
const Root = types.primitive.Root.Type;
const AnySignedBeaconBlock = @import("fork_types").AnySignedBeaconBlock;
const verifySingleSignatureSet = @import("../utils/signature_sets.zig").verifySingleSignatureSet;

pub fn verifyBlsToExecutionChangeSignature(config: *const BeaconConfig, signed_bls_to_execution_change: *const SignedBLSToExecutionChange) !bool {
    const signature_set = try getBlsToExecutionChangeSignatureSet(config, signed_bls_to_execution_change);
    return verifySingleSignatureSet(&signature_set);
}

pub fn getBlsToExecutionChangeSignatureSet(config: *const BeaconConfig, signed_bls_to_execution_change: *const SignedBLSToExecutionChange) !SingleSignatureSet {
    // signatureFork for signing domain is fixed
    const domain = try config.domain_cache.get(.phase0, c.DOMAIN_BLS_TO_EXECUTION_CHANGE);
    var signing_root: Root = undefined;
    try computeSigningRoot(types.capella.BLSToExecutionChange, &signed_bls_to_execution_change.message, domain, &signing_root);

    return SingleSignatureSet{
        .pubkey = try bls.PublicKey.uncompress(&signed_bls_to_execution_change.message.from_bls_pubkey),
        .signing_root = signing_root,
        .signature = signed_bls_to_execution_change.signature,
    };
}

pub fn getBlsToExecutionChangeSignatureSets(allocator: std.mem.Allocator, config: *const BeaconConfig, signed_block: *const AnySignedBeaconBlock, out: *std.ArrayList(SingleSignatureSet)) !void {
    const bls_to_execution_changes = signed_block.beaconBlock().beaconBlockBody().blsToExecutionChanges().items;
    for (bls_to_execution_changes) |signed_bls_to_execution_change| {
        const signature_set = try getBlsToExecutionChangeSignatureSet(config, signed_bls_to_execution_change);
        try out.append(allocator, signature_set);
    }
}
