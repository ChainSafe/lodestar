const std = @import("std");
const ssz = @import("ssz");
const napi = @import("zapi:zapi").napi;
const constants = @import("constants");
const ct = @import("consensus_types");

const bigint_fields = .{
    .{ ct.phase0.Eth1Data, "deposit_count" },
    .{ ct.deneb.ExecutionPayload, "blob_gas_used" },
    .{ ct.deneb.ExecutionPayload, "excess_blob_gas" },
    .{ ct.deneb.ExecutionPayloadHeader, "blob_gas_used" },
    .{ ct.deneb.ExecutionPayloadHeader, "excess_blob_gas" },
    .{ ct.gloas.ExecutionPayload, "blob_gas_used" },
    .{ ct.gloas.ExecutionPayload, "excess_blob_gas" },
    .{ ct.gloas.ExecutionPayloadBid, "gas_limit" },
    .{ ct.gloas.ExecutionPayloadBid, "execution_payment" },
    .{ ct.heze.ExecutionPayloadBid, "gas_limit" },
    .{ ct.heze.ExecutionPayloadBid, "execution_payment" },
    .{ ct.electra.BeaconState, "deposit_requests_start_index" },
    .{ ct.electra.BeaconState, "deposit_balance_to_consume" },
    .{ ct.electra.BeaconState, "exit_balance_to_consume" },
    .{ ct.electra.BeaconState, "consolidation_balance_to_consume" },
    .{ ct.fulu.BeaconState, "deposit_requests_start_index" },
    .{ ct.fulu.BeaconState, "deposit_balance_to_consume" },
    .{ ct.fulu.BeaconState, "exit_balance_to_consume" },
    .{ ct.fulu.BeaconState, "consolidation_balance_to_consume" },
    .{ ct.gloas.BeaconState, "deposit_requests_start_index" },
    .{ ct.gloas.BeaconState, "deposit_balance_to_consume" },
    .{ ct.gloas.BeaconState, "exit_balance_to_consume" },
    .{ ct.gloas.BeaconState, "consolidation_balance_to_consume" },
    .{ ct.heze.BeaconState, "deposit_balance_to_consume" },
    .{ ct.heze.BeaconState, "exit_balance_to_consume" },
    .{ ct.heze.BeaconState, "consolidation_balance_to_consume" },
    .{ ct.capella.Withdrawal, "amount" },
    .{ ct.electra.PendingPartialWithdrawal, "amount" },
    .{ ct.electra.WithdrawalRequest, "amount" },
};

comptime {
    for (bigint_fields) |entry| {
        if (@FieldType(entry[0].Type, entry[1]) != u64) {
            @compileError("Bigint field must be u64: " ++ entry[1]);
        }
    }
}

pub fn sszValueToNapiValue(env: napi.Env, comptime ST: type, value: *const ST.Type) !napi.Value {
    switch (ST.kind) {
        .uint => {
            if (@bitSizeOf(ST.Type) > 64) {
                var words: [@divExact(@bitSizeOf(ST.Type), 64)]u64 = undefined;
                inline for (0..words.len) |i| words[i] = @truncate(value.* >> (64 * i));
                return env.createBigintWords(0, &words);
            }
            if (ST.Type == u64 and value.* == constants.FAR_FUTURE_EPOCH) {
                return try (try env.getGlobal()).getNamedProperty("Infinity");
            }
            // Number fields follow Lodestar's floating-point representation;
            // converting through i64 would trap for otherwise valid u64 values.
            return try env.createDouble(@floatFromInt(value.*));
        },
        .bool => {
            return try env.getBoolean(value.*);
        },
        .vector => {
            if (comptime ssz.isBitVectorType(ST)) {
                return try bitArrayToNapiValue(env, value.data[0..], ST.length);
            } else if (comptime ssz.isByteVectorType(ST)) {
                var bytes: [*]u8 = undefined;
                const buf = try env.createArrayBuffer(ST.length, &bytes);
                @memcpy(bytes[0..ST.length], value);
                return try env.createTypedarray(.uint8, ST.length, buf, 0);
            } else {
                const arr = try env.createArrayWithLength(ST.length);
                for (value, 0..) |*v, i| {
                    const napi_element = try sszValueToNapiValue(env, ST.Element, v);
                    try arr.setElement(@intCast(i), napi_element);
                }
                return arr;
            }
        },
        .list, .progressive_list => {
            if (comptime ssz.isBitListType(ST)) {
                return try bitArrayToNapiValue(env, value.data.items, value.bit_len);
            } else if (comptime ssz.isByteListType(ST) or ssz.isProgressiveByteListType(ST)) {
                var bytes: [*]u8 = undefined;
                const buf = try env.createArrayBuffer(value.items.len, &bytes);
                @memcpy(bytes[0..value.items.len], value.items);
                return try env.createTypedarray(.uint8, value.items.len, buf, 0);
            } else {
                const arr = try env.createArrayWithLength(value.items.len);
                for (value.items, 0..) |*v, i| {
                    const napi_element = try sszValueToNapiValue(env, ST.Element, v);
                    try arr.setElement(@intCast(i), napi_element);
                }
                return arr;
            }
        },
        .progressive_bit_list => {
            return try bitArrayToNapiValue(env, value.data.items, value.bit_len);
        },
        .container, .progressive_container => {
            const bigint_flags = comptime blk: {
                var flags: [ST.fields.len]bool = @splat(false);
                for (bigint_fields) |entry| {
                    if (ST == entry[0]) flags[ST.getFieldIndex(entry[1])] = true;
                }
                break :blk flags;
            };
            const obj = try env.createObject();
            inline for (ST.fields, 0..) |field, i| {
                const field_value = &@field(value, field.name);
                const napi_field_value = if (comptime bigint_flags[i])
                    try env.createBigintUint64(field_value.*)
                else
                    try sszValueToNapiValue(env, field.type, field_value);
                try obj.setNamedProperty(snakeToCamel(field.name), napi_field_value);
            }
            return obj;
        },
        .compatible_union => {
            const selector = ST.getSelector(value);
            const obj = try env.createObject();
            try obj.setNamedProperty("selector", try env.createInt64(@intCast(selector)));

            inline for (ST._union_options) |option| {
                if (selector == option.@"0") {
                    const option_type = option.@"1";
                    const field_name = comptime std.fmt.comptimePrint("option_{d}", .{option.@"0"});
                    const union_value = &@field(value.*, field_name);
                    const napi_union_value = try sszValueToNapiValue(env, option_type, union_value);
                    try obj.setNamedProperty("value", napi_union_value);
                    return obj;
                }
            }

            return error.InvalidSelector;
        },
    }
}

fn bitArrayToNapiValue(env: napi.Env, data: []const u8, bit_len: usize) !napi.Value {
    var bytes: [*]u8 = undefined;
    const buf = try env.createArrayBuffer(data.len, &bytes);
    @memcpy(bytes[0..data.len], data);
    const uint8_array = try env.createTypedarray(.uint8, data.len, buf, 0);

    const obj = try env.createObject();
    try obj.setNamedProperty("uint8Array", uint8_array);
    try obj.setNamedProperty("bitLen", try env.createInt64(@intCast(bit_len)));
    return obj;
}

const NumberSliceOpts = struct {
    typed_array: ?napi.value_types.TypedarrayType = null,
};

pub fn numberSliceToNapiValue(
    env: napi.Env,
    comptime T: type,
    numbers: []const T,
    comptime opts: NumberSliceOpts,
) !napi.Value {
    if (opts.typed_array) |typed_array_type| {
        var bytes: [*]u8 = undefined;
        const bytes_len = numbers.len * typed_array_type.elementSize();
        const buf = try env.createArrayBuffer(bytes_len, &bytes);
        if (T == typed_array_type.elementType()) {
            @memcpy(bytes[0..bytes_len], @as([]const u8, @ptrCast(numbers)));
        } else {
            const ET = typed_array_type.elementType();
            const bytes_numbers_ptr: [*]ET = @ptrCast(@alignCast(bytes));
            const bytes_numbers = bytes_numbers_ptr[0..numbers.len];
            for (numbers, 0..) |num, i| {
                bytes_numbers[i] = std.math.cast(ET, num) orelse return error.IntegerOutOfRange;
            }
        }
        return try env.createTypedarray(typed_array_type, numbers.len, buf, 0);
    } else {
        const arr = try env.createArrayWithLength(numbers.len);
        for (numbers, 0..) |num, i| {
            const napi_element = try env.createDouble(@floatFromInt(num));
            try arr.setElement(@intCast(i), napi_element);
        }
        return arr;
    }
}

pub fn snakeToCamel(comptime str: []const u8) [:0]const u8 {
    const count = comptime count: {
        var n: usize = 0;
        for (str) |c| {
            if (c != '_') n += 1;
        }
        break :count n;
    };

    const result = comptime result: {
        var buf: [count:0]u8 = undefined;
        var out_idx: usize = 0;
        var capitalize = false;

        for (str) |c| {
            if (c == '_') {
                capitalize = true;
            } else {
                if (capitalize) {
                    buf[out_idx] = std.ascii.toUpper(c);
                    capitalize = false;
                } else {
                    buf[out_idx] = c;
                }
                out_idx += 1;
            }
        }
        buf[count] = 0;
        break :result buf;
    };

    return &result;
}
