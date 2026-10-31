const std = @import("std");
const era = @import("era");
const download_era_options = @import("download_era_options");
const c = @import("config");

const allocator = std.testing.allocator;

test "validate an existing era file" {
    const era_path = try std.fs.path.join(
        allocator,
        &[_][]const u8{ download_era_options.era_out_dir, download_era_options.era_files[0] },
    );
    defer allocator.free(era_path);

    // First check that the era file exists
    if (std.Io.Dir.openFile(.cwd(), std.testing.io, era_path, .{})) |f| {
        f.close(std.testing.io);
    } else |_| {
        return error.SkipZigTest;
    }

    var reader = try era.Reader.open(allocator, std.testing.io, c.mainnet.config, era_path);
    defer reader.close(allocator);

    // Main validation
    try reader.validate(allocator);
}

test "write an era file from an existing era file" {
    const era_path = try std.fs.path.join(
        allocator,
        &[_][]const u8{ download_era_options.era_out_dir, download_era_options.era_files[0] },
    );
    defer allocator.free(era_path);

    // First check that the era file exists
    if (std.Io.Dir.openFile(.cwd(), std.testing.io, era_path, .{})) |f| {
        f.close(std.testing.io);
    } else |_| {
        return error.SkipZigTest;
    }

    // Read known-good era file
    var reader = try era.Reader.open(allocator, std.testing.io, c.mainnet.config, era_path);
    defer reader.close(allocator);

    var tmp_dir = std.testing.tmpDir(.{});
    defer tmp_dir.cleanup();

    const tmp_dir_path = try tmp_dir.dir.realPathFileAlloc(std.testing.io, ".", allocator);
    defer allocator.free(tmp_dir_path);
    const out_path = try std.fs.path.join(allocator, &[_][]const u8{ tmp_dir_path, "out.era" });
    defer allocator.free(out_path);

    // Write known-good era to a new era file
    var writer = try era.Writer.open(c.mainnet.config, std.testing.io, out_path, reader.era_number);

    const blocks_index = reader.group_indices[0].blocks_index orelse return error.NoBlockIndex;
    for (blocks_index.start_slot..blocks_index.start_slot + blocks_index.offsets.len) |slot| {
        const block = try reader.readBlock(allocator, slot) orelse continue;
        defer block.deinit(allocator);

        try writer.writeBlock(allocator, block);
    }
    var state = try reader.readState(allocator, null);
    defer state.deinit();

    try writer.writeState(allocator, state);

    const final_out_path = try writer.finish(allocator, std.testing.io);
    defer allocator.free(final_out_path);

    // Now check that the two era files are equivalent

    // Compare file names
    if (!std.mem.eql(u8, std.fs.path.basename(final_out_path), std.fs.path.basename(era_path))) {
        return error.IncorrectWrittenEraFileName;
    }
    var out_reader = try era.Reader.open(allocator, std.testing.io, c.mainnet.config, final_out_path);
    defer out_reader.close(allocator);

    // Compare struct fields
    if (out_reader.era_number != reader.era_number) {
        return error.IncorrectWrittenEraNumber;
    }
    if (!std.mem.eql(u8, &reader.short_era_root, &out_reader.short_era_root)) {
        return error.IncorrectWrittenShortHistoricalRoot;
    }

    // Compare blocks
    for (blocks_index.start_slot..blocks_index.start_slot + blocks_index.offsets.len) |slot| {
        const block = try reader.readSerializedBlock(allocator, slot) orelse continue;
        const out_block = try out_reader.readSerializedBlock(allocator, slot) orelse return error.MissingBlock;
        defer allocator.free(block);
        defer allocator.free(out_block);

        if (!std.mem.eql(u8, block, out_block)) {
            return error.IncorrectWrittenBlock;
        }
    }
    // Compare state
    var out_state = try out_reader.readState(allocator, null);
    defer out_state.deinit();

    const serialized = try state.serialize(allocator);
    defer allocator.free(serialized);
    const out_serialized = try out_state.serialize(allocator);
    defer allocator.free(out_serialized);

    if (!std.mem.eql(u8, serialized, out_serialized)) {
        return error.IncorrectWrittenState;
    }
}
