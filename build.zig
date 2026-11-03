const std = @import("std");
const zapi = @import("zapi");
const zbuild = @import("zbuild");

pub fn build(b: *std.Build) !void {
    @setEvalBranchQuota(200_000);
    const manifest = @import("build.zig.zon");
    const result = try zbuild.configureBuild(b, manifest, .{});
    addGossipSha256(b, result.module("network").?);
    // snappy.zig leaves its static library to the target's default, which is not position independent for musl, and
    // the addon links it into a shared library.
    result.dependency("snappy").?.artifact("snappy").root_module.pic = true;
    // binding.zig checks its quiche_send_info against the C compiler's layout for the target.
    const network = result.module("network").?;
    const send_info_layout = b.addTranslateC(.{
        .root_source_file = b.path("src/network/quic/send_info_layout.h"),
        .target = network.resolved_target.?,
        .optimize = network.optimize.?,
    });
    send_info_layout.addIncludePath(result.dependency("quiche_zig").?.builder.dependency("quiche", .{}).path("include"));
    network.addImport("quiche_send_info_layout", send_info_layout.createModule());

    const network_tools = b.step("check:network-tools", "Compile network examples, interoperability peers, and benchmark");
    for ([_][]const u8{ "discv5_interop", "discv5_crawl", "network_interop_peer", "core_interop_peer", "bench_network" }) |name| {
        network_tools.dependOn(&result.executable(name).?.step);
    }

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

    try configureEreVerifier(b, result);
}

/// Adapts the prebuilt verifier's platform-specific linkage.
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
fn configureEreVerifier(b: *std.Build, result: zbuild.BuildResult) !void {
    const package = result.dependency("ere").?;
    const bindings = result.library("bindings").?;
    const target = bindings.root_module.resolved_target.?.result;
    if (target.os.tag == .linux and target.abi == .gnu) {
        // ere 0.19.2 retains unused strong imports for newer glibc, including quiche's weak libc references.
        // Remove only those symbols, preserving the local symbols used for profiling.
        for (package.module("ere").link_objects.items) |*object| switch (object.*) {
            .static_path => |archive| {
                const objcopy = try b.findProgram(&.{"llvm-objcopy"}, &.{});
                const clean = b.addSystemCommand(&.{ objcopy, "--strip-symbol=posix_spawn_file_actions_addchdir", "--strip-symbol=pidfd_spawnp", "--strip-symbol=pidfd_getpid" });
                clean.addFileArg(archive);
                object.* = .{ .static_path = clean.addOutputFileArg("libere_verifier_c.a") };
            },
            else => {},
        };
    }
    if (package.builder.named_lazy_paths.get("libere_verifier_c.dylib")) |dylib| {
        const install = b.addInstallLibFile(dylib, "libere_verifier_c.dylib");
        b.top_level_steps.get("build-lib:bindings").?.step.dependOn(&install.step);
    }
}

/// Links the network module, and so every test, tool and addon that imports it, to an object that
/// hashes gossip message ids and fingerprints with the CPU features Zig's Sha256 accelerates. Only
/// this object is compiled with them; `gossipsub/sha256.zig` runs it after detecting them.
fn addGossipSha256(b: *std.Build, network: *std.Build.Module) void {
    const dispatch = b.option(bool, "gossip-sha256-dispatch", "Link the accelerated gossip SHA-256 object and select it at run time (default: true)") orelse true;
    const arm = b.option(bool, "gossip-sha256-arm", "Also dispatch on aarch64 Linux and macOS, before ARM hardware has qualified it (default: false)") orelse false;
    const target = network.resolved_target.?;
    const os = target.result.os.tag;
    const features: ?std.Target.Cpu.Feature.Set = switch (target.result.cpu.arch) {
        .x86_64 => std.Target.x86.featureSet(&.{ .sha, .avx2 }),
        .aarch64 => if (arm and (os == .linux or os == .macos)) std.Target.aarch64.featureSet(&.{ .neon, .sha2 }) else null,
        else => null,
    };
    const options = b.addOptions();
    options.addOption(bool, "accelerated", dispatch and features != null);
    network.addOptions("gossip_sha256_options", options);
    if (!dispatch) return;

    var query = target.query;
    query.cpu_model = .baseline;
    query.cpu_features_add = features orelse return;
    query.cpu_features_sub = .empty;
    const object = b.addObject(.{
        .name = "gossip_sha256",
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/network/gossipsub/sha256_accelerated.zig"),
            .target = b.resolveTargetQuery(query),
            .optimize = network.optimize,
            .pic = true,
        }),
    });
    // Without link-time optimization, none of the object's code can be inlined into baseline code.
    object.lto = .none;
    object.bundle_compiler_rt = false;
    object.bundle_ubsan_rt = false;
    network.addObject(object);
}
