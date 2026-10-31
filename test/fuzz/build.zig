const std = @import("std");
const afl = @import("afl");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

    const lodestar_z = b.dependency("lodestar_z", .{
        .target = target,
        .optimize = optimize,
    });

    const dep_blst = b.dependency("blst", .{
        .optimize = optimize,
        .target = target,
    });

    const dep_snappy = b.dependency("snappy", .{
        .target = target,
        .optimize = optimize,
    });

    const dep_hashtree = b.dependency("hashtree", .{
        .target = target,
        .optimize = optimize,
    });

    // Tool: extract corpus seeds from spec test vectors
    {
        const extract_mod = b.createModule(.{
            .root_source_file = b.path(
                "tools/extract_spec_corpus.zig",
            ),
            .target = target,
            .optimize = optimize,
        });
        extract_mod.addImport(
            "snappy",
            dep_snappy.module("snappy"),
        );
        const extract_exe = b.addExecutable(.{
            .name = "extract_spec_corpus",
            .root_module = extract_mod,
        });
        const run_extract = b.addRunArtifact(extract_exe);
        run_extract.setCwd(b.path("."));
        const extract_step = b.step(
            "extract-corpus",
            "Extract spec test vectors as corpus seeds",
        );
        extract_step.dependOn(&run_extract.step);
    }

    const Fuzzer = struct {
        name: []const u8,
        extra_libs: []const *std.Build.Step.Compile = &.{},

        /// Returns the corpus directory path for this fuzzer.
        /// Change the suffix to switch between -cmin and -initial.
        fn corpus(self: @This(), bb: *std.Build) []const u8 {
            return bb.fmt("corpus/{s}-cmin", .{self.name});
        }

        fn source(self: @This(), bb: *std.Build) []const u8 {
            return bb.fmt("src/fuzz_{s}.zig", .{self.name});
        }
    };

    const fuzzers = &[_]Fuzzer{
        .{ .name = "ssz_basic" },
        .{ .name = "ssz_bitlist" },
        .{ .name = "ssz_bitvector" },
        .{ .name = "ssz_bytelist" },
        .{ .name = "ssz_containers" },
        .{ .name = "ssz_lists" },
        .{ .name = "ssz_chunked_leaf_set", .extra_libs = &.{dep_hashtree.artifact("hashtree")} },
        .{ .name = "ssz_nested_opaque_proof", .extra_libs = &.{dep_hashtree.artifact("hashtree")} },
        .{ .name = "ssz_opaque_roundtrip", .extra_libs = &.{dep_hashtree.artifact("hashtree")} },
        .{ .name = "bls_public_key", .extra_libs = &.{dep_blst.artifact("blst")} },
        .{ .name = "bls_signature", .extra_libs = &.{dep_blst.artifact("blst")} },
        .{ .name = "bls_aggregate_pk", .extra_libs = &.{dep_blst.artifact("blst")} },
        .{ .name = "bls_aggregate_sig", .extra_libs = &.{dep_blst.artifact("blst")} },
    };

    inline for (fuzzers) |fuzzer| {
        const run_step = b.step(
            b.fmt("run-{s}", .{fuzzer.name}),
            b.fmt("Run {s} with afl-fuzz", .{fuzzer.name}),
        );

        const lib_mod = b.createModule(.{
            .root_source_file = b.path(fuzzer.source(b)),
            .target = target,
            .optimize = optimize,
        });
        lib_mod.addImport("ssz", lodestar_z.module("ssz"));
        lib_mod.addImport("bls", lodestar_z.module("bls"));
        lib_mod.addImport(
            "consensus_types",
            lodestar_z.module("consensus_types"),
        );
        lib_mod.addImport("preset", lodestar_z.module("preset"));
        lib_mod.addImport("constants", lodestar_z.module("constants"));
        lib_mod.addImport(
            "persistent_merkle_tree",
            lodestar_z.module("persistent_merkle_tree"),
        );

        const lib = b.addLibrary(.{
            .name = fuzzer.name,
            .root_module = lib_mod,
        });
        lib.root_module.stack_check = false;
        lib.root_module.fuzz = true;

        const exe = afl.addInstrumentedExe(b, lib, fuzzer.extra_libs);
        const mkdir = b.addSystemCommand(&.{
            "mkdir", "-p",
        });
        mkdir.addDirectoryArg(
            b.path(b.fmt("afl-out/{s}", .{fuzzer.name})),
        );
        const run = afl.addFuzzerRun(
            b,
            exe,
            b.path(fuzzer.corpus(b)),
            b.path(b.fmt("afl-out/{s}", .{fuzzer.name})),
        );
        run.step.dependOn(&mkdir.step);
        run_step.dependOn(&run.step);

        const install = b.addInstallBinFile(
            exe,
            b.fmt("fuzz-{s}", .{fuzzer.name}),
        );
        b.getInstallStep().dependOn(&install.step);
    }
}
