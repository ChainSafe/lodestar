const std = @import("std");
const zapi = @import("zapi");
const zbuild = @import("zbuild");

pub fn build(b: *std.Build) !void {
    @setEvalBranchQuota(200_000);
    const manifest = @import("build.zig.zon");
    const result = try zbuild.configureBuild(b, manifest, .{});

    zapi.addAddonIdentity(
        b,
        result.library("bindings").?,
        manifest,
    );

    const spec_test_options = manifest.options_modules.spec_test_options;
    const print_spec_test_version = b.addSystemCommand(&.{
        "echo",
        b.fmt("{s}-generic-{s}-ssz-{s}-{s}", .{
            spec_test_options.spec_test_version.default,
            spec_test_options.ssz_generic_spec_test_version.default,
            spec_test_options.ssz_spec_test_version.default,
            spec_test_options.ssz_spec_test_sha256.default,
        }),
    });
    b.step("spec-test-version", "Print the pinned spec test cache key").dependOn(&print_spec_test_version.step);

    configureEreVerifier(b, result);
    configureLeanvm(b, result);
}

/// HACK:
/// Manually make ere.zig link `libere_verifier_c` into the `ere_verifier` module. A Zig
/// linker bug makes us have to workaround this way:
///
/// - Mach-O: Zig's stab parser assumes every function stab group is exactly
///   BNSYM, FUN, FUN, ENSYM and aborts on the `N_SOL` entries in ere's merged
///   object. With stabs stripped it links, but it detects TLV initialisers by
///   the `$tlv$init` symbol name, and dyld rejects the output as a malformed
///   thread-local.
///   Workaround: We convert the archive into `libere_verifier_c.dylib`
///   with Apple's `ld` and install it next to `bindings.node`,
///   where its `@loader_path` rpath finds it at runtime.
///
///   Sources:
///   https://codeberg.org/ziglang/zig/src/commit/7647adab80dd088f4de3610fd245915a912eb6ad/src/link/MachO/Object.zig#L1001-L1019
///   https://codeberg.org/ziglang/zig/src/commit/7647adab80dd088f4de3610fd245915a912eb6ad/src/link/MachO/Symbol.zig#L46
fn configureEreVerifier(b: *std.Build, result: zbuild.BuildResult) void {
    const package = result.dependency("ere").?;
    if (package.builder.named_lazy_paths.get("libere_verifier_c.dylib")) |dylib| {
        const install = b.addInstallLibFile(dylib, "libere_verifier_c.dylib");
        b.top_level_steps.get("build-lib:bindings").?.step.dependOn(&install.step);
    }
}

/// Links `rust/leanvm`, a Rust crate that wraps leanVM, into the `leanvm` module. A target not
/// built here gets the module with `leanvm_available = false`.
///
/// The archive is built once per machine, not per checkout: it lives in Zig's global cache under
/// a hash of what determines it, and cargo runs only when that archive is missing. Running cargo
/// needs rustup, which installs the toolchain `rust-toolchain.toml` pins, and that toolchain's
/// standard library for the target (`rustup target add`).
fn configureLeanvm(b: *std.Build, result: zbuild.BuildResult) void {
    const module = result.module("leanvm").?;
    const target = module.resolved_target.?;
    const rust_cpu = b.option(
        []const u8,
        "rust-cpu",
        "rustc's target-cpu for leanVM. Defaults to native for a native build, else to the portable baseline",
    );

    const triple = leanvmRustTriple(target.result);
    // Named for the package: an options file identical to another package's in one compilation
    // is one file rooting two modules, which Zig rejects.
    const options = b.addOptions();
    options.addOption(bool, "leanvm_available", triple != null);
    options.addOption(bool, "leanvm_baseline_cpu", rust_cpu == null and !leanvmIsNative(target));
    module.addOptions("leanvm_options", options);

    const rust_triple = triple orelse return;
    const cpu = rust_cpu orelse leanvmDefaultCpu(target);
    const crate = "rust/leanvm";
    // Absolute, as cargo runs in another directory: the global cache's path may be relative.
    const shared = b.pathResolve(&.{ b.graph.cache.cwd, b.graph.global_cache_root.path orelse ".", "lodestar-leanvm" });
    const key = leanvmArchiveKey(b, crate, rust_triple, cpu) catch |err|
        std.debug.panic("cannot read {s}: {t}", .{ crate, err });
    const archive = b.pathJoin(&.{ shared, &key, "liblodestar_leanvm.a" });

    module.link_libc = true;
    // Rust's unwinder, which macOS has in libSystem.
    if (target.result.os.tag == .linux) module.linkSystemLibrary("unwind", .{});
    if (std.Io.Dir.accessAbsolute(b.graph.io, archive, .{})) {
        module.addObjectFile(.{ .cwd_relative = archive });
        return;
    } else |_| {}

    // Every checkout shares one target directory, so only the crate itself is rebuilt after
    // an edit to it: leanVM is a git dependency, the same package wherever the checkout is.
    const target_dir = b.pathJoin(&.{ shared, "target" });
    const cargo = b.addSystemCommand(&.{
        "cargo", "build", "--release", "--locked", "--target", rust_triple, "--target-dir", target_dir,
    });
    // rustup reads `rust-toolchain.toml`, which is part of the key, from the working directory.
    cargo.setCwd(b.path(crate));
    cargo.removeEnvironmentVariable("RUSTUP_TOOLCHAIN");
    cargo.setEnvironmentVariable("RUSTFLAGS", b.fmt("-C target-cpu={s}", .{cpu}));
    cargo.has_side_effects = true;

    // Cargo's own lock ends with cargo, before its archive is copied.
    const lock = b.allocator.create(LockArchives) catch @panic("OOM");
    lock.* = .{
        .step = .init(.{ .id = .custom, .name = "lock leanvm archives", .owner = b, .makeFn = LockArchives.make }),
        .dir = shared,
    };
    cargo.step.dependOn(&lock.step);

    const publish = b.allocator.create(PublishArchive) catch @panic("OOM");
    publish.* = .{
        .step = .init(.{ .id = .custom, .name = "publish leanvm archive", .owner = b, .makeFn = PublishArchive.make }),
        .lock = lock,
        .from = b.pathJoin(&.{ target_dir, rust_triple, "release", "liblodestar_leanvm.a" }),
        .to = archive,
    };
    publish.step.dependOn(&cargo.step);
    const published = b.allocator.create(std.Build.GeneratedFile) catch @panic("OOM");
    published.* = .{ .step = &publish.step, .path = archive };
    module.addObjectFile(.{ .generated = .{ .file = published } });
}

/// Held from before cargo runs until its archive is published. Cargo writes every build for a
/// target to one path in the shared target directory, so without this a second build, of other
/// sources or for another CPU, could replace the archive before the first is copied out.
///
/// A failed cargo leaves it held until the build exits.
const LockArchives = struct {
    step: std.Build.Step,
    dir: []const u8,
    file: ?std.Io.File = null,

    fn make(step: *std.Build.Step, _: std.Build.Step.MakeOptions) !void {
        const self: *LockArchives = @fieldParentPtr("step", step);
        const io = step.owner.graph.io;
        var dir = try std.Io.Dir.cwd().createDirPathOpen(io, self.dir, .{});
        defer dir.close(io);
        self.file = try dir.createFile(io, "lock", .{ .truncate = false, .lock = .exclusive });
    }
};

/// Copies cargo's archive to the path its key names. The copy is atomic, so a build that does
/// not take the lock never links half of one.
const PublishArchive = struct {
    step: std.Build.Step,
    lock: *LockArchives,
    from: []const u8,
    to: []const u8,

    fn make(step: *std.Build.Step, _: std.Build.Step.MakeOptions) !void {
        const self: *PublishArchive = @fieldParentPtr("step", step);
        const io = step.owner.graph.io;
        defer if (self.lock.file) |file| file.close(io);
        const cwd = std.Io.Dir.cwd();
        try cwd.copyFile(self.from, cwd, self.to, io, .{ .make_path = true });
    }
};

/// A hash of everything that determines the archive: the crate's files, which pin leanVM and
/// the Rust toolchain, the target and its CPU. A file added to the crate is added here.
fn leanvmArchiveKey(b: *std.Build, crate: []const u8, rust_triple: []const u8, cpu: []const u8) ![32]u8 {
    var hasher = std.crypto.hash.sha2.Sha256.init(.{});
    for ([_][]const u8{ "Cargo.toml", "Cargo.lock", "rust-toolchain.toml", "src/lib.rs" }) |name| {
        const path = b.pathJoin(&.{ crate, name });
        const contents = try b.build_root.handle.readFileAlloc(b.graph.io, path, b.allocator, .unlimited);
        hasher.update(std.mem.asBytes(&@as(u64, contents.len)));
        hasher.update(contents);
    }
    hasher.update(rust_triple);
    hasher.update(&.{0});
    hasher.update(cpu);
    // `native` is this machine's CPU, which a cache carried to another machine would not know.
    if (std.mem.eql(u8, cpu, "native")) hasher.update(b.graph.host.result.cpu.model.name);
    var digest: [32]u8 = undefined;
    hasher.final(&digest);
    return std.fmt.bytesToHex(digest[0..16], .lower);
}

fn leanvmRustTriple(target: std.Target) ?[]const u8 {
    return switch (target.os.tag) {
        .linux => switch (target.cpu.arch) {
            .x86_64 => switch (target.abi) {
                .gnu => "x86_64-unknown-linux-gnu",
                .musl => "x86_64-unknown-linux-musl",
                else => null,
            },
            .aarch64 => switch (target.abi) {
                .gnu => "aarch64-unknown-linux-gnu",
                .musl => "aarch64-unknown-linux-musl",
                else => null,
            },
            else => null,
        },
        .macos => switch (target.cpu.arch) {
            .x86_64 => "x86_64-apple-darwin",
            .aarch64 => "aarch64-apple-darwin",
            else => null,
        },
        else => null,
    };
}

fn leanvmIsNative(target: std.Build.ResolvedTarget) bool {
    return target.query.isNativeOs() and target.query.isNativeCpu();
}

/// The prover's kernels are chosen at compile time by ISA, so a build for this machine takes
/// all of it. Any other build may run elsewhere, and takes the ISA leanVM's CI tests on x86-64
/// and the NEON kernels' `aes` (PMULL) on arm64. `leanvm.cpuSupported` checks that baseline at
/// run time, so a change here is a change there.
fn leanvmDefaultCpu(target: std.Build.ResolvedTarget) []const u8 {
    if (leanvmIsNative(target)) return "native";
    return switch (target.result.cpu.arch) {
        .x86_64 => "haswell",
        // Every arm64 Mac has at least this.
        else => if (target.result.os.tag == .macos) "apple-m1" else "generic -C target-feature=+aes",
    };
}
