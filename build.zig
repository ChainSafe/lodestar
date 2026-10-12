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

    configureEreVerifier(b, result);
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
