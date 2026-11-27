const std = @import("std");

/// Creates a build step that produces an AFL++-instrumented fuzzing
/// executable.
///
/// Returns a `LazyPath` to the resulting fuzzing executable.
pub fn addInstrumentedExe(
    b: *std.Build,
    obj: *std.Build.Step.Compile,
    extra_libs: []const *std.Build.Step.Compile,
) std.Build.LazyPath {
    const pkg = b.dependencyFromBuildZig(
        @This(),
        .{},
    );

    const afl_cc = b.addSystemCommand(&.{
        b.findProgram(.{ .names = &.{"afl-cc"} }) orelse
            @panic("Could not find 'afl-cc', which is required to build"),
        "-O3",
    });
    afl_cc.addArg("-o");
    const fuzz_exe = afl_cc.addOutputFileArg(obj.name);
    afl_cc.addFileArg(pkg.path("afl.c"));
    const archive = obj.getEmittedBin();
    // Zig already instruments the ELF archive with sanitizer coverage. Link it
    // directly on Linux so AFL++ does not need a compatible LLVM bitcode reader.
    // Preserve the existing Mach-O path, where section placement differs.
    afl_cc.addFileArg(if (obj.root_module.resolved_target.?.result.os.tag == .linux)
        archive
    else
        obj.getEmittedLlvmBc());
    for (extra_libs) |lib| {
        afl_cc.addFileArg(lib.getEmittedBin());
    }
    return fuzz_exe;
}

/// Creates a run step that invokes `afl-fuzz` with the given instrumented
/// executable, input corpus directory, and output directory.
///
/// Returns the `Run` step so callers can wire it into a build step.
pub fn addFuzzerRun(
    b: *std.Build,
    exe: std.Build.LazyPath,
    corpus_dir: std.Build.LazyPath,
    output_dir: std.Build.LazyPath,
) *std.Build.Step.Run {
    const run = b.addSystemCommand(&.{
        b.findProgram(.{ .names = &.{"afl-fuzz"} }) orelse
            @panic("Could not find 'afl-fuzz', which is required to run"),
        "-i",
    });
    run.addDirectoryArg(corpus_dir);
    run.addArgs(&.{"-o"});
    run.addDirectoryArg(output_dir);
    run.addArgs(&.{"--"});
    run.addFileArg(exe);
    return run;
}

// Required so `zig build` works although it does nothing.
pub fn build(b: *std.Build) !void {
    _ = b;
}
