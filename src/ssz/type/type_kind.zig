pub const TypeKind = enum {
    uint,
    bool,
    vector,
    list,
    progressive_list,
    progressive_bit_list,
    container,
    progressive_container,
    compatible_union,
};

/// Basic types are primitives
pub fn isBasicType(T: type) bool {
    return T.kind == .uint or T.kind == .bool;
}

const builtin = @import("builtin");
const native_endian = builtin.target.cpu.arch.endian();

/// Whether a bulk memcpy can replace per-element serialize/deserialize.
///
/// SSZ encodes integers in little-endian. On little-endian platforms,
/// the in-memory layout of uint types already matches SSZ encoding,
/// so a single memcpy replaces N individual writeInt/readInt calls.
pub fn canMemcpySsz(comptime T: type) bool {
    return T.kind == .uint and native_endian == .little;
}

// Fixed-size types have a known size
pub fn isFixedType(T: type) bool {
    return switch (T.kind) {
        .uint, .bool => true,
        .list, .progressive_list, .progressive_bit_list, .compatible_union => false,
        .vector => isFixedType(T.Element),
        .container, .progressive_container => {
            inline for (T.fields) |field| {
                if (!isFixedType(field.type)) {
                    return false;
                }
            }
            return true;
        },
    };
}
