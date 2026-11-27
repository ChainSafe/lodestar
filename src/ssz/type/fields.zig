pub const Field = struct {
    name: [:0]const u8,
    type: type,
};

pub fn fields(comptime T: type) []const Field {
    return comptime blk: {
        const info = switch (@typeInfo(T)) {
            .@"struct" => |info| info,
            else => @compileError("Expected a struct type."),
        };
        var result: [info.field_names.len]Field = undefined;
        for (info.field_names, info.field_types, 0..) |name, FieldType, i| {
            result[i] = .{ .name = name, .type = FieldType };
        }
        const frozen = result;
        break :blk &frozen;
    };
}
