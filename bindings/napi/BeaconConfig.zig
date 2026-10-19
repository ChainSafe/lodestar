//! Configurations share one application-wide validator-index to pubkey mapping.

const std = @import("std");
const napi = @import("zapi:zapi").napi;
const js = @import("zapi:zapi").js;
const active_preset = @import("preset").active_preset;
const c = @import("config");
const NativeBeaconConfig = c.BeaconConfig;
const ChainConfig = @import("config").ChainConfig;
const Preset = @import("preset").Preset;

pub const js_meta = js.class(.{});

config_rc: *OwnedConfigRc,
const BeaconConfig = @This();

/// Copies configuration inputs into storage retained by every state created with it.
pub fn init(chain_config: js.Value, genesis_validators_root: js.Uint8Array) !BeaconConfig {
    return .{ .config_rc = try create(std.heap.c_allocator, chain_config, genesis_validators_root) };
}

pub fn deinit(self: *BeaconConfig) void {
    self.config_rc.unref();
}

const max_blob_schedule_entries = 16;

const OwnedConfig = struct {
    config: NativeBeaconConfig = undefined,
    config_name: [64]u8 = undefined,
    blob_schedule: [max_blob_schedule_entries]ChainConfig.BlobScheduleEntry = undefined,

    pub fn deinit(_: *OwnedConfig) void {}
};

pub const OwnedConfigRc = @import("state_transition").RefCount(OwnedConfig);

fn defaultChainConfig() ChainConfig {
    return switch (active_preset) {
        .mainnet => c.mainnet.config.chain,
        .minimal => c.minimal.config.chain,
        .gnosis => c.chiado.config.chain,
    };
}

fn create(allocator: std.mem.Allocator, object: js.Value, genesis_root: js.Uint8Array) !*OwnedConfigRc {
    const root_slice = try genesis_root.toSlice();
    if (root_slice.len != 32) return error.InvalidGenesisValidatorsRootLength;
    // Configuration getters may detach the input buffer.
    const root = root_slice[0..32].*;

    const owned = try OwnedConfigRc.create(allocator, .{});
    errdefer owned.unref();

    const object_value = try object.toValue().coerceToObject();
    var chain_config = try chainConfigFromObject(
        &owned.instance,
        js.env(),
        object_value,
    );
    if (chain_config.PRESET_BASE != active_preset) return error.PresetMismatch;
    if (try (try object_value.getNamedProperty("SLOT_DURATION_MS")).typeof() == .undefined) {
        chain_config.SLOT_DURATION_MS = std.math.mul(u64, chain_config.SECONDS_PER_SLOT, 1000) catch {
            return error.InvalidSlotDuration;
        };
    }
    for ([_]u64{ chain_config.SLOT_DURATION_MS, chain_config.SLOT_DURATION_MS_HEZE }) |duration_ms| {
        if (duration_ms == 0 or duration_ms % 1000 != 0) return error.InvalidSlotDuration;
    }
    chain_config.SECONDS_PER_SLOT = @divExact(chain_config.SLOT_DURATION_MS, 1000);
    owned.instance.config = NativeBeaconConfig.init(chain_config, root);
    return owned;
}

fn chainConfigU64(value: napi.Value) !u64 {
    const number: js.Number = .{ .val = value };
    // Lodestar uses Infinity for disabled fork epochs.
    if (std.math.isPositiveInf(try number.toF64())) return std.math.maxInt(u64);
    return number.toU64Exact() catch |err| switch (err) {
        error.InvalidUnsignedInteger => error.InvalidChainConfigFieldValue,
        else => err,
    };
}

fn chainConfigFromObject(owned: *OwnedConfig, env: napi.Env, obj: napi.Value) !ChainConfig {
    var chain_config = defaultChainConfig();

    inline for (std.meta.fields(ChainConfig)) |field| {
        const field_value: napi.Value = obj.getNamedProperty(field.name) catch |err| {
            try env.throwError(@errorName(err), "Missing field " ++ field.name);
            return error.PendingException;
        };

        if (try field_value.typeof() == .undefined) {
            std.log.debug("missing field value for: {s}, skipping\n", .{field.name});
        } else {
            switch (field.type) {
                Preset => {
                    var str_buf: [16]u8 = undefined;
                    const preset_str = try field_value.getValueStringUtf8(&str_buf);
                    @field(chain_config, field.name) =
                        if (std.mem.eql(u8, preset_str, "mainnet"))
                            .mainnet
                        else if (std.mem.eql(u8, preset_str, "minimal"))
                            .minimal
                        else if (std.mem.eql(u8, preset_str, "gnosis"))
                            .gnosis
                        else
                            return error.InvalidPreset;
                },
                u64 => @field(chain_config, field.name) = try chainConfigU64(field_value),
                u256 => {
                    var str_buf: [128]u8 = undefined;
                    const str = try (try field_value.coerceToString()).getValueStringUtf8(&str_buf);
                    @field(chain_config, field.name) = std.fmt.parseInt(u256, str, 10) catch {
                        return error.InvalidChainConfigFieldValue;
                    };
                },
                [4]u8 => {
                    const typedarray_info = try field_value.getTypedarrayInfo();
                    if (typedarray_info.data.len != 4) {
                        return error.InvalidVersionLength;
                    }
                    var version: [4]u8 = undefined;
                    @memcpy(&version, typedarray_info.data);
                    @field(chain_config, field.name) = version;
                },
                [20]u8 => {
                    const typedarray_info = try field_value.getTypedarrayInfo();
                    if (typedarray_info.data.len != 20) {
                        return error.InvalidAddressLength;
                    }
                    var address: [20]u8 = undefined;
                    @memcpy(&address, typedarray_info.data);
                    @field(chain_config, field.name) = address;
                },
                [32]u8 => {
                    const typedarray_info = try field_value.getTypedarrayInfo();
                    if (typedarray_info.data.len != 32) {
                        return error.InvalidRootLength;
                    }
                    var root: [32]u8 = undefined;
                    @memcpy(&root, typedarray_info.data);
                    @field(chain_config, field.name) = root;
                },
                []const u8 => {
                    const config_name = try field_value.getValueStringUtf8(&owned.config_name);
                    if (comptime std.mem.eql(u8, field.name, "CONFIG_NAME")) {
                        @field(chain_config, field.name) = config_name;
                    } else {
                        @compileError("unsupported field: " ++ field.name);
                    }
                },
                []const ChainConfig.BlobScheduleEntry => {
                    const array_length: usize = @intCast(try field_value.getArrayLength());
                    if (array_length > max_blob_schedule_entries) {
                        return error.BlobScheduleTooLong;
                    }

                    for (0..array_length) |i| {
                        const entry_value = try field_value.getElement(@intCast(i));
                        const epoch_value = try entry_value.getNamedProperty("EPOCH");
                        const max_blobs_value = try entry_value.getNamedProperty("MAX_BLOBS_PER_BLOCK");

                        const blob_schedule_entry = ChainConfig.BlobScheduleEntry{
                            .EPOCH = try chainConfigU64(epoch_value),
                            .MAX_BLOBS_PER_BLOCK = try chainConfigU64(max_blobs_value),
                        };
                        owned.blob_schedule[i] = blob_schedule_entry;
                    }
                    @field(chain_config, field.name) = owned.blob_schedule[0..array_length];
                },
                else => return error.UnsupportedChainConfigFieldType,
            }
        }
    }
    return chain_config;
}
