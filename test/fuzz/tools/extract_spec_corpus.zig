const std = @import("std");
const snappy = @import("snappy").raw;
const wire_types = @import("ssz_wire_types");

const Allocator = std.mem.Allocator;
const Dir = std.Io.Dir;

/// Selector byte mapping for each fuzz target.
/// First byte of corpus file selects which SSZ type to test.

// ssz_basic: Bool=0, Uint8=1, Uint16=2, Uint32=3,
//            Uint64=4, Uint128=5, Uint256=6
const uint_selectors = [_]struct { bits: []const u8, sel: u8 }{
    .{ .bits = "8", .sel = 0x01 },
    .{ .bits = "16", .sel = 0x02 },
    .{ .bits = "32", .sel = 0x03 },
    .{ .bits = "64", .sel = 0x04 },
    .{ .bits = "128", .sel = 0x05 },
    .{ .bits = "256", .sel = 0x06 },
};

// ssz_bitlist: BitList(8)=0, BitList(64)=1, BitList(2048)=2
const bitlist_selectors = [_]struct {
    limit: []const u8,
    sel: u8,
}{
    .{ .limit = "1", .sel = 0x00 },
    .{ .limit = "2", .sel = 0x00 },
    .{ .limit = "3", .sel = 0x00 },
    .{ .limit = "4", .sel = 0x00 },
    .{ .limit = "5", .sel = 0x00 },
    .{ .limit = "8", .sel = 0x00 },
    .{ .limit = "16", .sel = 0x01 },
    .{ .limit = "31", .sel = 0x01 },
    .{ .limit = "512", .sel = 0x02 },
    .{ .limit = "513", .sel = 0x02 },
};

// ssz_bitvector: BitVector(4)=0, BitVector(32)=1,
//               BitVector(64)=2
const bitvec_selectors = [_]struct {
    size: []const u8,
    sel: u8,
}{
    .{ .size = "1", .sel = 0x00 },
    .{ .size = "2", .sel = 0x00 },
    .{ .size = "3", .sel = 0x00 },
    .{ .size = "4", .sel = 0x00 },
    .{ .size = "5", .sel = 0x01 },
    .{ .size = "8", .sel = 0x01 },
    .{ .size = "16", .sel = 0x01 },
    .{ .size = "31", .sel = 0x01 },
    .{ .size = "512", .sel = 0x03 },
    .{ .size = "513", .sel = 0x03 },
};

// ssz_containers: consensus types
const container_selectors = [_]struct {
    name: []const u8,
    sel: u8,
}{
    .{ .name = "Fork", .sel = 0x00 },
    .{ .name = "Checkpoint", .sel = 0x01 },
    .{ .name = "AttestationData", .sel = 0x02 },
    .{ .name = "Eth1Data", .sel = 0x03 },
    .{ .name = "BeaconBlockHeader", .sel = 0x04 },
    .{ .name = "Validator", .sel = 0x05 },
    .{ .name = "Attestation", .sel = 0x06 },
    .{ .name = "IndexedAttestation", .sel = 0x07 },
};

/// 4 MiB buffer size — enough for any spec test vector.
const buf_len = 4 * 1024 * 1024;

/// Read a .ssz_snappy file, decompress it, and return
/// the raw SSZ bytes (slice into decompress_buf).
///
/// Uses separate buffers for compressed and decompressed
/// data to prevent aliasing during decompression.
fn readSnappy(
    dir: Dir,
    io: std.Io,
    path: []const u8,
    read_buf: []u8,
    decompress_buf: []u8,
) ![]const u8 {
    std.debug.assert(read_buf.len > 0);
    std.debug.assert(decompress_buf.len > 0);

    const compressed = dir.readFile(
        io,
        path,
        read_buf,
    ) catch {
        return error.ReadFailed;
    };
    const uncompressed_len = snappy.uncompressedLength(
        compressed,
    ) catch {
        return error.SnappyInvalid;
    };
    std.debug.assert(uncompressed_len <= decompress_buf.len);

    const len = snappy.uncompress(
        compressed,
        decompress_buf[0..uncompressed_len],
    ) catch {
        return error.SnappyDecompress;
    };
    std.debug.assert(len == uncompressed_len);
    return decompress_buf[0..len];
}

/// Write [selector_byte][ssz_data] to corpus directory.
fn writeCorpus(
    corpus_dir: Dir,
    io: std.Io,
    name: []const u8,
    selector: u8,
    ssz_data: []const u8,
) !void {
    const file = corpus_dir.createFile(io, name, .{}) catch {
        return error.CreateFailed;
    };
    defer file.close(io);

    var write_buf: [4096]u8 = undefined;
    var file_writer = file.writer(io, &write_buf);
    var writer = &file_writer.interface;
    try writer.writeByte(selector);
    try writer.writeAll(ssz_data);
    try file_writer.end();
}

fn extractBasic(
    spec_dir: Dir,
    corpus_dir: Dir,
    io: std.Io,
    read_buf: []u8,
    decompress_buf: []u8,
    name_buf: []u8,
) !u32 {
    var count: u32 = 0;

    // Boolean → selector 0x00.
    if (spec_dir.openDir(
        io,
        "boolean/valid",
        .{ .iterate = true },
    ) catch null) |dir_obj| {
        var dir = dir_obj;
        defer dir.close(io);

        var iter = dir.iterate();
        while (try iter.next(io)) |entry| {
            if (entry.kind != .directory) continue;
            if (entry.name[0] == '.') continue;
            const snappy_path = try std.fmt.bufPrint(
                name_buf,
                "{s}/serialized.ssz_snappy",
                .{entry.name},
            );
            const ssz = readSnappy(
                dir,
                io,
                snappy_path,
                read_buf,
                decompress_buf,
            ) catch continue;
            const out_name = try std.fmt.bufPrint(
                name_buf[snappy_path.len..],
                "spec-bool-{s}",
                .{entry.name},
            );
            try writeCorpus(
                corpus_dir,
                io,
                out_name,
                0x00,
                ssz,
            );
            count += 1;
        }
    }

    // Uints → selectors 0x01-0x06.
    if (spec_dir.openDir(
        io,
        "uints/valid",
        .{ .iterate = true },
    ) catch null) |dir_obj| {
        var dir = dir_obj;
        defer dir.close(io);

        var iter = dir.iterate();
        while (try iter.next(io)) |entry| {
            if (entry.kind != .directory) continue;
            if (entry.name[0] == '.') continue;

            // Parse "uint_<bits>_<variant>" to get bits
            const sel = findUintSelector(
                entry.name,
            ) orelse continue;

            const snappy_path = try std.fmt.bufPrint(
                name_buf,
                "{s}/serialized.ssz_snappy",
                .{entry.name},
            );
            const ssz = readSnappy(
                dir,
                io,
                snappy_path,
                read_buf,
                decompress_buf,
            ) catch continue;
            const out_name = try std.fmt.bufPrint(
                name_buf[snappy_path.len..],
                "spec-{s}",
                .{entry.name},
            );
            try writeCorpus(
                corpus_dir,
                io,
                out_name,
                sel,
                ssz,
            );
            count += 1;
        }
    }

    return count;
}

fn findUintSelector(name: []const u8) ?u8 {
    // name = "uint_<bits>_<variant>"
    if (!std.mem.startsWith(u8, name, "uint_")) {
        return null;
    }
    const rest = name["uint_".len..];
    // Find end of bits number
    const sep = std.mem.findScalar(u8, rest, '_') orelse
        return null;
    const bits = rest[0..sep];
    for (uint_selectors) |entry| {
        if (std.mem.eql(u8, bits, entry.bits)) {
            return entry.sel;
        }
    }
    return null;
}

fn extractBitlist(
    spec_dir: Dir,
    corpus_dir: Dir,
    io: std.Io,
    read_buf: []u8,
    decompress_buf: []u8,
    name_buf: []u8,
) !u32 {
    var count: u32 = 0;

    const dir_result = spec_dir.openDir(
        io,
        "bitlist/valid",
        .{ .iterate = true },
    ) catch return 0;
    var dir = dir_result;
    defer dir.close(io);

    var iter = dir.iterate();
    while (try iter.next(io)) |entry| {
        if (entry.kind != .directory) continue;
        if (entry.name[0] == '.') continue;

        // Parse "bitlist_<limit>_<variant>_<n>".
        const sel = findPrefixSelector(
            entry.name,
            "bitlist_",
            &bitlist_selectors,
        ) orelse continue;

        const snappy_path = try std.fmt.bufPrint(
            name_buf,
            "{s}/serialized.ssz_snappy",
            .{entry.name},
        );
        const ssz = readSnappy(
            dir,
            io,
            snappy_path,
            read_buf,
            decompress_buf,
        ) catch continue;
        const out_name = try std.fmt.bufPrint(
            name_buf[snappy_path.len..],
            "spec-{s}",
            .{entry.name},
        );
        try writeCorpus(corpus_dir, io, out_name, sel, ssz);
        count += 1;
    }

    return count;
}

fn extractBitvector(
    spec_dir: Dir,
    corpus_dir: Dir,
    io: std.Io,
    read_buf: []u8,
    decompress_buf: []u8,
    name_buf: []u8,
) !u32 {
    var count: u32 = 0;

    const dir_result = spec_dir.openDir(
        io,
        "bitvector/valid",
        .{ .iterate = true },
    ) catch return 0;
    var dir = dir_result;
    defer dir.close(io);

    var iter = dir.iterate();
    while (try iter.next(io)) |entry| {
        if (entry.kind != .directory) continue;
        if (entry.name[0] == '.') continue;

        // Parse "bitvec_<size>_<variant>".
        const sel = findPrefixSelector(
            entry.name,
            "bitvec_",
            &bitvec_selectors,
        ) orelse continue;

        const snappy_path = try std.fmt.bufPrint(
            name_buf,
            "{s}/serialized.ssz_snappy",
            .{entry.name},
        );
        const ssz = readSnappy(
            dir,
            io,
            snappy_path,
            read_buf,
            decompress_buf,
        ) catch continue;
        const out_name = try std.fmt.bufPrint(
            name_buf[snappy_path.len..],
            "spec-{s}",
            .{entry.name},
        );
        try writeCorpus(corpus_dir, io, out_name, sel, ssz);
        count += 1;
    }

    return count;
}

fn extractContainers(
    static_dir: Dir,
    corpus_dir: Dir,
    io: std.Io,
    read_buf: []u8,
    decompress_buf: []u8,
    name_buf: []u8,
) !u32 {
    var count: u32 = 0;

    for (container_selectors) |cs| {
        const type_dir_result = static_dir.openDir(
            io,
            cs.name,
            .{ .iterate = true },
        ) catch continue;
        var type_dir = type_dir_result;
        defer type_dir.close(io);
        count += try extractTypeDir(
            &type_dir,
            corpus_dir,
            io,
            read_buf,
            decompress_buf,
            name_buf,
            cs.sel,
            cs.name,
            std.math.maxInt(usize),
        );
    }
    return count;
}

/// Writes every `<category>/<case>/serialized.ssz_snappy` under a type directory as
/// `spec-<label>-<category>-<case>`, skipping vectors larger than `seed_max`.
fn extractTypeDir(
    type_dir: *Dir,
    corpus_dir: Dir,
    io: std.Io,
    read_buf: []u8,
    decompress_buf: []u8,
    name_buf: []u8,
    selector: u8,
    label: []const u8,
    seed_max: usize,
) !u32 {
    var count: u32 = 0;
    var cat_iter = type_dir.iterate();
    while (try cat_iter.next(io)) |cat| {
        if (cat.kind != .directory) continue;
        if (cat.name[0] == '.') continue;
        var cat_dir = type_dir.openDir(
            io,
            cat.name,
            .{ .iterate = true },
        ) catch continue;
        defer cat_dir.close(io);
        var case_iter = cat_dir.iterate();
        while (try case_iter.next(io)) |cas| {
            if (cas.kind != .directory) continue;
            if (cas.name[0] == '.') continue;
            const snappy_path = try std.fmt.bufPrint(
                name_buf,
                "{s}/serialized.ssz_snappy",
                .{cas.name},
            );
            const ssz = readSnappy(
                cat_dir,
                io,
                snappy_path,
                read_buf,
                decompress_buf,
            ) catch continue;
            if (ssz.len > seed_max) continue;
            const out_name = try std.fmt.bufPrint(
                name_buf[snappy_path.len..],
                "spec-{s}-{s}-{s}",
                .{ label, cat.name, cas.name },
            );
            try writeCorpus(
                corpus_dir,
                io,
                out_name,
                selector,
                ssz,
            );
            count += 1;
        }
    }
    return count;
}

/// AFL never runs an input above its default 1 MiB ceiling, so larger vectors are skipped.
const wire_seed_max: usize = 1024 * 1024;

fn extractWireTypes(
    mainnet_dir: ?Dir,
    corpus_dir: Dir,
    io: std.Io,
    read_buf: []u8,
    decompress_buf: []u8,
    name_buf: []u8,
) !u32 {
    var count: u32 = 0;
    inline for (wire_types.entries, 0..) |entry, index| {
        const T = entry.T;
        const value = &T.default_value;
        const size = if (@hasDecl(T, "fixed_size")) T.fixed_size else T.serializedSize(value);
        std.debug.assert(size <= decompress_buf.len);
        std.debug.assert(T.serializeIntoBytes(value, decompress_buf[0..size]) == size);
        const out_name = try std.fmt.bufPrint(
            name_buf,
            "default-{s}-{s}",
            .{ entry.fork, entry.name },
        );
        try writeCorpus(corpus_dir, io, out_name, @intCast(index), decompress_buf[0..size]);
        count += 1;
    }
    const base = mainnet_dir orelse return count;
    for (wire_types.sources) |source| {
        var label_buf: [128]u8 = undefined;
        const label = try std.fmt.bufPrint(&label_buf, "{s}-{s}", .{ source.fork, source.name });
        const type_path = try std.fmt.bufPrint(
            name_buf,
            "{s}/ssz_static/{s}",
            .{ source.fork, source.name },
        );
        var type_dir = base.openDir(io, type_path, .{ .iterate = true }) catch continue;
        defer type_dir.close(io);
        count += try extractTypeDir(
            &type_dir,
            corpus_dir,
            io,
            read_buf,
            decompress_buf,
            name_buf,
            source.selector,
            label,
            wire_seed_max,
        );
    }
    return count;
}

const Versions = struct { consensus: []const u8, generic: []const u8 };

/// test/spec/version.txt: comment lines, a blank, the consensus version, then `ssz_generic <v>`.
fn readVersions(io: std.Io, buf: []u8) !Versions {
    const text = Dir.cwd().readFile(io, "../../test/spec/version.txt", buf) catch {
        std.debug.print("Cannot read test/spec/version.txt; run: zig build run:download_spec_tests\n", .{});
        return error.MissingVersionFile;
    };
    var consensus: ?[]const u8 = null;
    var lines = std.mem.splitScalar(u8, text, '\n');
    while (lines.next()) |raw| {
        const line = std.mem.trim(u8, raw, " \r\t");
        if (line.len == 0 or std.mem.startsWith(u8, line, "//")) continue;
        if (consensus == null) {
            consensus = line;
            continue;
        }
        if (std.mem.startsWith(u8, line, "ssz_generic ")) {
            return .{ .consensus = consensus.?, .generic = line["ssz_generic ".len..] };
        }
    }
    return error.MalformedVersionFile;
}

fn findPrefixSelector(
    name: []const u8,
    prefix: []const u8,
    selectors: anytype,
) ?u8 {
    if (!std.mem.startsWith(u8, name, prefix)) {
        return null;
    }
    const rest = name[prefix.len..];
    const sep = std.mem.findScalar(u8, rest, '_') orelse
        return null;
    const key = rest[0..sep];
    for (selectors) |entry| {
        const field = if (@hasField(
            @TypeOf(entry),
            "limit",
        )) entry.limit else entry.size;
        if (std.mem.eql(u8, key, field)) {
            return entry.sel;
        }
    }
    return null;
}

pub fn main(init: std.process.Init) !void {
    var gpa: std.heap.DebugAllocator(.{}) = .init;
    defer std.debug.assert(gpa.deinit() == .ok);
    const allocator = gpa.allocator();
    const io = init.io;

    const read_buf = try allocator.alloc(u8, buf_len);
    defer allocator.free(read_buf);

    const decompress_buf = try allocator.alloc(u8, buf_len);
    defer allocator.free(decompress_buf);

    var name_buf: [4096]u8 = undefined;

    // Resolve paths relative to this tool's location.
    // Build system places the exe; we use CWD (test/fuzz/).
    const cwd = std.Io.Dir.cwd();

    var version_buf: [1024]u8 = undefined;
    const versions = try readVersions(io, &version_buf);
    var generic_path_buf: [256]u8 = undefined;
    const generic_path = try std.fmt.bufPrint(
        &generic_path_buf,
        "../../test/spec/spec_tests/{s}/general/tests/general/phase0/ssz_generic",
        .{versions.generic},
    );
    var static_path_buf: [256]u8 = undefined;
    const static_path = try std.fmt.bufPrint(
        &static_path_buf,
        "../../test/spec/spec_tests/{s}/minimal/tests/minimal/phase0/ssz_static",
        .{versions.consensus},
    );
    var mainnet_path_buf: [256]u8 = undefined;
    const mainnet_path = try std.fmt.bufPrint(
        &mainnet_path_buf,
        "../../test/spec/spec_tests/{s}/mainnet/tests/mainnet",
        .{versions.consensus},
    );

    var generic_dir = cwd.openDir(
        io,
        generic_path,
        .{},
    ) catch |err| {
        std.debug.print(
            "Cannot open spec tests at {s}: {}\n" ++
                "Run: zig build run:download_spec_tests\n",
            .{ generic_path, err },
        );
        return err;
    };
    defer generic_dir.close(io);

    var static_dir = cwd.openDir(
        io,
        static_path,
        .{},
    ) catch |err| {
        std.debug.print(
            "Cannot open spec tests at {s}: {}\n" ++
                "Run: zig build run:download_spec_tests\n",
            .{ static_path, err },
        );
        return err;
    };
    defer static_dir.close(io);

    var mainnet_dir: ?Dir = cwd.openDir(io, mainnet_path, .{}) catch null;
    defer if (mainnet_dir) |*dir| dir.close(io);
    if (mainnet_dir == null) {
        std.debug.print(
            "No mainnet vectors at {s}; ssz_wire_types gets default-value seeds only\n",
            .{mainnet_path},
        );
    }
    std.debug.print(
        "Extracting spec test vectors as corpus seeds...\n\n",
        .{},
    );

    var total: u32 = 0;

    // ssz_basic
    {
        var dir = try cwd.openDir(
            io,
            "corpus/ssz_basic-initial",
            .{},
        );
        defer dir.close(io);

        const n = try extractBasic(
            generic_dir,
            dir,
            io,
            read_buf,
            decompress_buf,
            &name_buf,
        );
        std.debug.print("  ssz_basic: {} vectors\n", .{n});
        total += n;
    }

    // ssz_bitlist
    {
        var dir = try cwd.openDir(
            io,
            "corpus/ssz_bitlist-initial",
            .{},
        );
        defer dir.close(io);

        const n = try extractBitlist(
            generic_dir,
            dir,
            io,
            read_buf,
            decompress_buf,
            &name_buf,
        );
        std.debug.print(
            "  ssz_bitlist: {} vectors\n",
            .{n},
        );
        total += n;
    }

    // ssz_bitvector
    {
        var dir = try cwd.openDir(
            io,
            "corpus/ssz_bitvector-initial",
            .{},
        );
        defer dir.close(io);

        const n = try extractBitvector(
            generic_dir,
            dir,
            io,
            read_buf,
            decompress_buf,
            &name_buf,
        );
        std.debug.print(
            "  ssz_bitvector: {} vectors\n",
            .{n},
        );
        total += n;
    }

    // ssz_containers
    {
        var dir = try cwd.openDir(
            io,
            "corpus/ssz_containers-initial",
            .{},
        );
        defer dir.close(io);

        const n = try extractContainers(
            static_dir,
            dir,
            io,
            read_buf,
            decompress_buf,
            &name_buf,
        );
        std.debug.print(
            "  ssz_containers: {} vectors\n",
            .{n},
        );
        total += n;
    }

    // ssz_wire_types: every seed here is generated, so a fresh checkout has no directory yet.
    {
        cwd.createDirPath(io, "corpus/ssz_wire_types-initial") catch |err| switch (err) {
            error.PathAlreadyExists => {},
            else => return err,
        };
        var dir = try cwd.openDir(
            io,
            "corpus/ssz_wire_types-initial",
            .{},
        );
        defer dir.close(io);
        const n = try extractWireTypes(
            mainnet_dir,
            dir,
            io,
            read_buf,
            decompress_buf,
            &name_buf,
        );
        std.debug.print(
            "  ssz_wire_types: {} seeds\n",
            .{n},
        );
        total += n;
    }
    std.debug.print(
        "\nTotal: {} corpus files generated\n",
        .{total},
    );
    std.debug.print(
        "\nNote: ssz_bytelist and ssz_lists have no" ++
            " matching spec vectors.\n" ++
            "Their hand-crafted seeds are retained.\n",
        .{},
    );
}
