const Domain = types.primitive.Domain.Type;
const Root = types.primitive.Root.Type;
const types = @import("consensus_types");

const SigningData = types.phase0.SigningData.Type;

/// Return the signing root of an object by calculating the root of the object-domain tree.
pub fn computeSigningRoot(comptime T: type, ssz_object: *const T.Type, domain: *const Domain, out: *[32]u8) !void {
    var object_root: Root = undefined;
    try T.hashTreeRoot(ssz_object, &object_root);
    const domain_wrapped_object: SigningData = .{
        .object_root = object_root,
        .domain = domain.*,
    };

    try types.phase0.SigningData.hashTreeRoot(&domain_wrapped_object, out);
}

/// Return the signing root of an object from its root.
pub fn computeSigningRootFromObjectRoot(object_root: *const Root, domain: *const Domain, out: *[32]u8) !void {
    const domain_wrapped_object: SigningData = .{
        .object_root = object_root.*,
        .domain = domain.*,
    };
    try types.phase0.SigningData.hashTreeRoot(&domain_wrapped_object, out);
}
