//! Repo-wide lint rules that `zig fmt` cannot express.
//!
//! Run with `zig build test:tidy`.
//!
//! Most rules guard test discovery. Zig only collects tests from files reached
//! through an analyzed `test` block, so a test file that nothing imports
//! compiles cleanly, runs nothing, and still reports success. That failure is
//! invisible in CI, which makes it worth a lint rather than a code review.
//!
//! The remaining rule guards how error values are written. Both spellings
//! compile, so nothing but a lint keeps the rejected one out.
//!
//! Rules read the parsed AST rather than raw lines, so a brace or the word
//! `test` inside a comment or string literal cannot skew them. Every rule
//! reports all of its violations before failing, so one run shows the full list
//! instead of only the first item. Each rule also has a test below that feeds it
//! synthetic source and asserts the exact diagnostics, so a rule that stops
//! catching anything fails here rather than going quiet.

const std = @import("std");
const testing = std.testing;
const Allocator = std.mem.Allocator;
const Ast = std.zig.Ast;
const assert = std.debug.assert;

/// Upper bounds. The lint walks a source tree of known size, and these keep a
/// runaway walk or a pathological file from turning a lint into an OOM.
const max_tracked_files = 4096;
const max_file_bytes: std.Io.Limit = .limited(8 << 20);
const max_git_output_bytes = 4 << 20;

/// A file holds at most this many `test` blocks. One inline test is a usage
/// example; a second makes it a suite, and suites live in a sibling
/// `<file>_test.zig`. The wiring block counts, so a file is either inline
/// (one test) or extracted (only the wiring block), never both. Documented in
/// AGENTS.md.
const max_test_blocks = 1;

/// Files that deliberately keep their tests inline. Their tests exercise private
/// declarations that a sibling `_test.zig` cannot reach, and widening those
/// declarations to `pub` purely to relocate a test is not a trade worth making.
///
/// `stale allowlist entry` fails when an entry stops needing the exemption, so
/// this list cannot quietly rot into a blanket exclusion.
const inline_test_allowlist = [_][]const u8{
    // Private methods on a public struct: destroyState.
    "src/beacon_node/chain/state_cache/block_state_cache.zig",
    // Private cgroup v1/v2 parsers: parseCpuV1, parseCpuMaxV2, translate.
    "src/cpu_count.zig",
    // Private methods on ForkChoice: updateHead, addLatestMessage, getProposerHead.
    "src/fork_choice/fork_choice.zig",
    // Private method on ProtoArray: init.
    "src/fork_choice/proto_array.zig",
    // Private helper: compatibleUnionOptionsAreCompatible.
    "src/ssz/type/compatible_union.zig",
    // Private diff internals: findModifiedIndices, loadValidators.
    "src/state_transition/load_state.zig",
    // Private helper: ComputeShuffledIndex.
    "src/state_transition/utils/committee_indices.zig",
    // Private helpers: computeSyncCommitteeIndices, computeSyncCommitteeMap.
    "src/state_transition/cache/sync_committee_cache.zig",
    // Private helpers: computeCommitteeCount, unshuffleList.
    "src/state_transition/utils/epoch_shuffling.zig",
};

/// Files that nothing imports on purpose. Entry points reached by the build
/// system rather than by an `@import`, so the dead-file rule cannot see them.
const unimported_file_allowlist = [_][]const u8{
    // Narrow roots for running one subtree's tests without compiling the rest.
    "src/state_transition/block_test_root.zig",
    "src/state_transition/utils_test_root.zig",
};

/// Rule scoping.
///
/// Wiring and discovery rules run repo-wide, because a test that never runs is
/// a defect anywhere. The other two are narrower on purpose:
///
///   - Dead-file detection covers shipped code only. Elsewhere, entry points are
///     declared programmatically (`test/fuzz/build.zig` builds its target paths
///     with `fmt`) or reached from generated sources, and neither is visible to
///     static analysis.
///   - The inline test limit is about keeping implementation files readable, so
///     it does not apply to trees that are themselves tests.
const dead_file_scope = [_][]const u8{ "src/", "packages/native/" };
const inline_test_scope = [_][]const u8{"src/"};

// -------------------------------------------------------------------------
// Diagnostics
// -------------------------------------------------------------------------

/// Accumulates diagnostics so a run reports every violation rather than the
/// first. Formats as `path:line: error: ...` so editors and CI can parse them.
const Errors = struct {
    gpa: Allocator,
    count: u32 = 0,
    /// Set by the rule tests below to assert exact output.
    captured: ?*std.ArrayList(u8) = null,

    fn emit(errors: *Errors, comptime fmt: []const u8, args: anytype) void {
        comptime assert(fmt[fmt.len - 1] == '\n');
        errors.count += 1;
        if (errors.captured) |captured| {
            const line = std.fmt.allocPrint(errors.gpa, fmt, args) catch @panic("OOM");
            defer errors.gpa.free(line);
            captured.appendSlice(errors.gpa, line) catch @panic("OOM");
        } else {
            std.debug.print(fmt, args);
        }
    }

    fn addParseError(errors: *Errors, path: []const u8, line: usize) void {
        errors.emit("{s}:{d}: error: cannot parse file\n", .{ path, line });
    }

    fn addOrphanTestFile(errors: *Errors, path: []const u8) void {
        errors.emit(
            "{s}: error: no `test {{ _ = @import(...); }}` pulls this in, so its tests never run\n",
            .{path},
        );
    }

    fn addUnpairedTestFile(errors: *Errors, path: []const u8, expected: []const u8) void {
        errors.emit(
            "{s}: error: no sibling file to pair with, expected {s}\n",
            .{ path, expected },
        );
    }

    fn addTestFileWiredElsewhere(errors: *Errors, path: []const u8, expected: []const u8) void {
        errors.emit(
            "{s}: error: {s} does not pull it in from a test block, " ++
                "wire it from the module under test\n",
            .{ path, expected },
        );
    }

    fn addRootMissingTestBlock(errors: *Errors, path: []const u8, sibling: []const u8) void {
        errors.emit(
            "{s}: error: no test block, but {s} has tests that will not run\n",
            .{ path, sibling },
        );
    }

    fn addDeadFile(errors: *Errors, path: []const u8) void {
        errors.emit("{s}: error: not reachable from any build root\n", .{path});
    }

    fn addModuleNotInCi(errors: *Errors, module: []const u8) void {
        errors.emit(
            "build.zig.zon: error: module `{s}` has no `zig build test:{s}` step in CI\n",
            .{ module, module },
        );
    }

    fn addTooManyTestBlocks(errors: *Errors, path: []const u8, line: usize, count: usize) void {
        errors.emit(
            "{s}:{d}: error: {d} test blocks, a file holds at most {d}; " ++
                "move the tests to a sibling _test.zig\n",
            .{ path, line, count, max_test_blocks },
        );
    }

    fn addStaleAllowlistEntry(errors: *Errors, path: []const u8, reason: []const u8) void {
        errors.emit("{s}: error: allowlisted but {s}\n", .{ path, reason });
    }

    fn addQualifiedErrorValue(
        errors: *Errors,
        path: []const u8,
        line: usize,
        set: []const u8,
        name: []const u8,
    ) void {
        errors.emit(
            "{s}:{d}: error: `{s}.{s}` names an error through its set, write `error.{s}`\n",
            .{ path, line, set, name, name },
        );
    }
};

// -------------------------------------------------------------------------
// Source model
// -------------------------------------------------------------------------

const InlineTests = struct {
    lines: usize = 0,
    count: usize = 0,
    /// One-based line of the first `test` declaration, for the diagnostic.
    first_line: usize = 0,
};

/// One `@import` in a file.
const Import = struct {
    /// The literal, exactly as written.
    path: []const u8,
    /// Whether the import sits inside a root-level `test` declaration.
    ///
    /// This is the difference between wiring that works and wiring that only
    /// looks like it does. Zig analyses a `test` block, so an import inside one
    /// pulls in that file's tests. A plain top-level `const x = @import(...)`
    /// that nothing references is never analysed, and its tests never run.
    in_test_block: bool,
};

/// One `<Set>.<Name>` reference to an error value.
const QualifiedErrorValue = struct {
    /// One-based line, for the diagnostic.
    line: usize,
    set: []const u8,
    name: []const u8,
};

/// One analyzed file. Everything a rule needs is extracted during the single
/// load pass, so no rule re-reads or re-parses.
const File = struct {
    path: []const u8,
    dir: []const u8,
    basename: []const u8,
    /// `@import` targets, taken from the token stream, so a commented-out or
    /// stringified import is not mistaken for a real one.
    imports: []const Import,
    inline_tests: InlineTests,
    error_set_names: []const []const u8,
    qualified_error_values: []const QualifiedErrorValue,

    fn hasTestBlock(file: File) bool {
        return file.inline_tests.count > 0;
    }

    fn importsBasename(file: File, basename: []const u8) bool {
        for (file.imports) |import| {
            if (std.mem.eql(u8, std.fs.path.basenamePosix(import.path), basename)) return true;
        }
        return false;
    }

    /// Imports the file from inside a `test` block, which is the only form that
    /// actually causes its tests to run.
    fn wiresTests(file: File, basename: []const u8) bool {
        for (file.imports) |import| {
            if (!import.in_test_block) continue;
            if (std.mem.eql(u8, std.fs.path.basenamePosix(import.path), basename)) return true;
        }
        return false;
    }
};

/// Parses one file and extracts everything the rules need.
fn analyze(gpa: Allocator, path: []const u8, text: [:0]const u8, errors: *Errors) !File {
    var tree = try Ast.parse(gpa, text, .zig);
    defer tree.deinit(gpa);

    if (tree.errors.len > 0) {
        const location = tree.tokenLocation(0, tree.errors[0].token);
        errors.addParseError(path, location.line + 1);
    }

    const TokenSpan = struct { first: Ast.TokenIndex, last: Ast.TokenIndex };
    var test_spans: std.ArrayList(TokenSpan) = .empty;
    var inline_tests: InlineTests = .{};
    for (tree.rootDecls()) |node| {
        if (tree.nodeTag(node) != .test_decl) continue;
        const first = tree.firstToken(node);
        const last = tree.lastToken(node);
        const line_first = tree.tokenLocation(0, first).line + 1;
        const line_last = tree.tokenLocation(0, last).line + 1;
        assert(line_last >= line_first);

        try test_spans.append(gpa, .{ .first = first, .last = last });
        inline_tests.count += 1;
        inline_tests.lines += line_last - line_first + 1;
        if (inline_tests.first_line == 0) inline_tests.first_line = line_first;
    }

    var imports: std.ArrayList(Import) = .empty;
    const token_tags = tree.tokens.items(.tag);
    for (token_tags, 0..) |tag, index| {
        if (tag != .builtin) continue;
        if (!std.mem.eql(u8, tree.tokenSlice(@intCast(index)), "@import")) continue;
        if (index + 2 >= token_tags.len) continue;
        if (token_tags[index + 1] != .l_paren) continue;
        if (token_tags[index + 2] != .string_literal) continue;

        const literal = tree.tokenSlice(@intCast(index + 2));
        assert(literal.len >= 2);

        const token: Ast.TokenIndex = @intCast(index);
        var in_test_block = false;
        for (test_spans.items) |span| {
            if (token >= span.first and token <= span.last) {
                in_test_block = true;
                break;
            }
        }
        try imports.append(gpa, .{
            .path = try gpa.dupe(u8, literal[1 .. literal.len - 1]),
            .in_test_block = in_test_block,
        });
    }

    // Collect error sets declared in this file. Looking up the declaration avoids
    // treating a struct such as `HttpError` as an error set merely because its
    // name ends in `Error`. Imported error sets retain the repository's `*Error`
    // naming convention because their declarations are outside this file.
    var error_set_names: std.ArrayList([]const u8) = .empty;
    var declared_names: std.ArrayList([]const u8) = .empty;
    for (token_tags, 0..) |tag, index| {
        if (tag != .keyword_const) continue;
        if (index + 2 >= token_tags.len) continue;
        if (token_tags[index + 1] != .identifier) continue;
        if (token_tags[index + 2] != .equal) continue;
        try declared_names.append(gpa, try gpa.dupe(u8, tree.tokenSlice(@intCast(index + 1))));

        var expression_index = index + 3;
        while (expression_index + 1 < token_tags.len and
            token_tags[expression_index] != .semicolon and
            token_tags[expression_index] != .l_brace) : (expression_index += 1)
        {
            if (token_tags[expression_index] != .keyword_error) continue;
            if (token_tags[expression_index + 1] != .l_brace) continue;
            try error_set_names.append(gpa, try gpa.dupe(u8, tree.tokenSlice(@intCast(index + 1))));
            break;
        }
    }

    var qualified_error_values: std.ArrayList(QualifiedErrorValue) = .empty;
    for (token_tags, 0..) |tag, index| {
        if (tag != .identifier) continue;
        if (index + 2 >= token_tags.len) continue;
        if (token_tags[index + 1] != .period) continue;
        if (token_tags[index + 2] != .identifier) continue;

        const set = tree.tokenSlice(@intCast(index));
        var is_error_set = false;
        for (error_set_names.items) |error_set_name| {
            if (std.mem.eql(u8, set, error_set_name)) {
                is_error_set = true;
                break;
            }
        }
        if (!is_error_set and std.mem.endsWith(u8, set, "Error")) {
            var declared_non_error = false;
            for (declared_names.items) |declared_name| {
                if (std.mem.eql(u8, set, declared_name)) {
                    declared_non_error = true;
                    break;
                }
            }
            is_error_set = !declared_non_error;
        }
        if (!is_error_set) continue;
        const name = tree.tokenSlice(@intCast(index + 2));
        assert(name.len > 0);
        if (!std.ascii.isUpper(name[0])) continue;

        try qualified_error_values.append(gpa, .{
            .line = tree.tokenLocation(0, @intCast(index)).line + 1,
            .set = try gpa.dupe(u8, set),
            .name = try gpa.dupe(u8, name),
        });
    }

    return .{
        .path = path,
        .dir = std.fs.path.dirnamePosix(path) orelse "",
        .basename = std.fs.path.basenamePosix(path),
        .imports = imports.items,
        .inline_tests = inline_tests,
        .error_set_names = error_set_names.items,
        .qualified_error_values = qualified_error_values.items,
    };
}

/// Lists the repository's tracked `.zig` files.
///
/// Uses `git ls-files` rather than a directory walk so the lint sees exactly
/// what is committed: no build output, no vendored packages, no generated spec
/// tests, and no untracked scratch files.
fn listTrackedZigFiles(gpa: Allocator, io: std.Io) ![]const []const u8 {
    const result = std.process.run(gpa, io, .{
        .argv = &.{ "git", "ls-files", "-z", "--", "*.zig" },
    }) catch |err| {
        std.debug.print(
            "tidy could not run `git ls-files` ({s}). Run it from a git checkout " ++
                "with `zig build test:tidy`.\n",
            .{@errorName(err)},
        );
        return err;
    };
    defer gpa.free(result.stderr);
    defer gpa.free(result.stdout);

    if (result.term != .exited or result.term.exited != 0) return error.GitFailed;
    if (result.stdout.len > max_git_output_bytes) return error.GitOutputTooLarge;

    var paths: std.ArrayList([]const u8) = .empty;
    var entries = std.mem.splitScalar(u8, result.stdout, 0);
    while (entries.next()) |entry| {
        if (entry.len == 0) continue;
        assert(paths.items.len < max_tracked_files);
        try paths.append(gpa, try gpa.dupe(u8, entry));
    }

    // A git checkout of this repository always has Zig sources.
    if (paths.items.len == 0) return error.NoTrackedSources;
    return paths.items;
}

fn loadRepo(gpa: Allocator, io: std.Io, errors: *Errors) ![]const File {
    const paths = try listTrackedZigFiles(gpa, io);
    const cwd: std.Io.Dir = .cwd();

    var files: std.ArrayList(File) = .empty;
    for (paths) |path| {
        // A tracked file missing from the working tree is a normal intermediate
        // state, such as a `git rm` that is not committed yet. Skip it rather
        // than failing the lint with a file-system error.
        const text = cwd.readFileAllocOptions(
            io,
            path,
            gpa,
            max_file_bytes,
            .of(u8),
            0,
        ) catch |err| switch (err) {
            error.FileNotFound => continue,
            else => return err,
        };
        try files.append(gpa, try analyze(gpa, path, text, errors));
    }
    return files.items;
}

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------

fn isTestFile(basename: []const u8) bool {
    return std.mem.endsWith(u8, basename, "_test.zig");
}

fn inScope(scope: []const []const u8, path: []const u8) bool {
    for (scope) |prefix| {
        if (std.mem.startsWith(u8, path, prefix)) return true;
    }
    return false;
}

fn listContains(list: []const []const u8, path: []const u8) bool {
    for (list) |entry| {
        if (std.mem.eql(u8, entry, path)) return true;
    }
    return false;
}

fn findFile(files: []const File, path: []const u8) ?*const File {
    for (files) |*file| {
        if (std.mem.eql(u8, file.path, path)) return file;
    }
    return null;
}

/// The sibling file a `<stem>_test.zig` pairs with. Accepts the snake_case
/// name and the TitleCase name, since a file that is itself a type keeps its
/// TitleCase name: `Node.zig` pairs with `node_test.zig`.
fn pairedFile(
    gpa: Allocator,
    dir: []const u8,
    stem: []const u8,
    style: enum { snake, title },
) ![]const u8 {
    var name: std.ArrayList(u8) = .empty;
    if (dir.len > 0) {
        try name.appendSlice(gpa, dir);
        try name.append(gpa, '/');
    }
    switch (style) {
        .snake => try name.appendSlice(gpa, stem),
        .title => {
            var parts = std.mem.splitScalar(u8, stem, '_');
            while (parts.next()) |part| {
                if (part.len == 0) continue;
                try name.append(gpa, std.ascii.toUpper(part[0]));
                try name.appendSlice(gpa, part[1..]);
            }
        },
    }
    try name.appendSlice(gpa, ".zig");
    return name.items;
}

// -------------------------------------------------------------------------
// Rules
// -------------------------------------------------------------------------

/// Every `_test.zig` must be imported, must pair with a file of the same
/// name, and must be wired from that file rather than from a module root.
fn tidyTestFileWiring(gpa: Allocator, files: []const File, errors: *Errors) !void {
    for (files) |file| {
        if (!isTestFile(file.basename)) continue;

        var wired = false;
        for (files) |other| {
            if (std.mem.eql(u8, other.path, file.path)) continue;
            if (other.wiresTests(file.basename)) {
                wired = true;
                break;
            }
        }
        if (!wired) {
            errors.addOrphanTestFile(file.path);
            continue;
        }

        const stem = file.basename[0 .. file.basename.len - "_test.zig".len];
        const snake = try pairedFile(gpa, file.dir, stem, .snake);
        const title = try pairedFile(gpa, file.dir, stem, .title);

        const pair = findFile(files, snake) orelse findFile(files, title) orelse {
            errors.addUnpairedTestFile(file.path, snake);
            continue;
        };
        if (!pair.wiresTests(file.basename)) {
            errors.addTestFileWiredElsewhere(file.path, pair.path);
        }
    }
}

/// A `root.zig` whose siblings have tests must declare a `test` block. Without
/// one those tests are never collected, because re-exporting a file with
/// `pub const` does not pull in its tests.
fn tidyRootTestBlocks(files: []const File, errors: *Errors) void {
    for (files) |root| {
        if (!std.mem.eql(u8, root.basename, "root.zig")) continue;
        if (root.hasTestBlock()) continue;

        for (files) |sibling| {
            if (!std.mem.eql(u8, sibling.dir, root.dir)) continue;
            if (std.mem.eql(u8, sibling.path, root.path)) continue;
            if (!sibling.hasTestBlock()) continue;

            errors.addRootMissingTestBlock(root.path, sibling.path);
            break;
        }
    }
}

/// Resolves an import literal against the importing file's directory.
///
/// Returns null for a module-name import such as `@import("hashing")`, which
/// the build resolves to another module's root rather than to a path relative
/// to this file.
fn resolveImport(gpa: Allocator, dir: []const u8, literal: []const u8) !?[]const u8 {
    if (!std.mem.endsWith(u8, literal, ".zig")) return null;

    var segments: std.ArrayList([]const u8) = .empty;
    var dir_parts = std.mem.splitScalar(u8, dir, '/');
    while (dir_parts.next()) |part| {
        if (part.len == 0 or std.mem.eql(u8, part, ".")) continue;
        try segments.append(gpa, part);
    }

    var parts = std.mem.splitScalar(u8, literal, '/');
    while (parts.next()) |part| {
        if (part.len == 0 or std.mem.eql(u8, part, ".")) continue;
        if (std.mem.eql(u8, part, "..")) {
            // An import climbing above the repository root is not ours to resolve.
            if (segments.items.len == 0) return null;
            _ = segments.pop();
            continue;
        }
        try segments.append(gpa, part);
    }
    return try std.mem.join(gpa, "/", segments.items);
}

/// Zig's lazy compilation hides files that nothing imports: the compiler never
/// sees them, so it cannot report them as unused, and any tests they hold are
/// silently skipped.
///
/// Reachability is traversed from the roots the build declares, rather than
/// asking whether each file has some incoming import. Those differ: two unused
/// files that import each other each have an incoming import, yet neither is
/// compiled and neither one's tests run.
fn tidyDeadFiles(
    gpa: Allocator,
    files: []const File,
    roots: []const []const u8,
    scope: []const []const u8,
    errors: *Errors,
) !void {
    const reachable = try gpa.alloc(bool, files.len);
    @memset(reachable, false);

    var queue: std.ArrayList(usize) = .empty;
    for (files, 0..) |file, index| {
        if (!listContains(roots, file.path)) continue;
        reachable[index] = true;
        try queue.append(gpa, index);
    }

    var head: usize = 0;
    while (head < queue.items.len) : (head += 1) {
        const file = files[queue.items[head]];
        for (file.imports) |import| {
            const target = try resolveImport(gpa, file.dir, import.path) orelse continue;
            for (files, 0..) |candidate, index| {
                if (reachable[index]) continue;
                if (!std.mem.eql(u8, candidate.path, target)) continue;
                reachable[index] = true;
                try queue.append(gpa, index);
            }
        }
    }
    // Each file is enqueued at most once.
    assert(queue.items.len <= files.len);

    for (files, 0..) |file, index| {
        if (reachable[index]) continue;
        if (!inScope(scope, file.path)) continue;
        if (listContains(&unimported_file_allowlist, file.path)) continue;
        errors.addDeadFile(file.path);
    }
}

/// No file holds more than `max_test_blocks` test blocks.
fn tidyInlineTests(files: []const File, scope: []const []const u8, errors: *Errors) void {
    for (files) |file| {
        if (!inScope(scope, file.path)) continue;
        if (isTestFile(file.basename)) continue;
        if (listContains(&inline_test_allowlist, file.path)) continue;

        const inline_tests = file.inline_tests;
        if (inline_tests.count > max_test_blocks) {
            errors.addTooManyTestBlocks(file.path, inline_tests.first_line, inline_tests.count);
        }
    }
}

/// Error values are written `error.Name`, never `Set.Name`.
///
/// Error names are global in Zig, so a set reference resolves to the same value
/// and the two spellings are interchangeable at every use site. Only one of them
/// stays correct: the qualified form has to be revisited whenever the value
/// moves between sets, and it reads as though the set, rather than the function's
/// return type, decides which errors can arrive.
fn tidyErrorValues(files: []const File, errors: *Errors) void {
    for (files) |file| {
        for (file.qualified_error_values) |value| {
            errors.addQualifiedErrorValue(file.path, value.line, value.set, value.name);
        }
    }
}

/// An exemption that outlives its reason turns an allowlist into a blanket
/// exclusion, so every entry has to still need it.
fn tidyAllowlists(files: []const File, errors: *Errors) void {
    for (inline_test_allowlist) |allowed| {
        const file = findFile(files, allowed) orelse {
            errors.addStaleAllowlistEntry(allowed, "the file does not exist");
            continue;
        };
        if (file.inline_tests.count <= max_test_blocks) {
            errors.addStaleAllowlistEntry(allowed, "it no longer exceeds the test block limit");
        }
    }
    for (unimported_file_allowlist) |allowed| {
        if (findFile(files, allowed) == null) {
            errors.addStaleAllowlistEntry(allowed, "the file does not exist");
        }
    }
}

/// Every module declared in `build.zig.zon` must have a CI step, otherwise its
/// tests never run on a pull request.
fn tidyCiCoverage(gpa: Allocator, zon: []const u8, ci: []const u8, errors: *Errors) !void {
    const modules = try declaredTestModules(gpa, zon);
    for (modules) |module| {
        const needle = try std.fmt.allocPrint(gpa, "zig build test:{s}", .{module});
        if (!containsStep(ci, needle)) errors.addModuleNotInCi(module);
    }
}

/// True when `haystack` contains `step` as a complete build target.
///
/// A plain substring search is not enough: `zig build test:ssz` occurs inside
/// `zig build test:ssz_generic_spec_tests`, so dropping the real `test:ssz`
/// step would still look covered. The match only counts when the target name
/// ends there, rather than continuing into a longer name.
fn containsStep(haystack: []const u8, step: []const u8) bool {
    var offset: usize = 0;
    while (std.mem.findPos(u8, haystack, offset, step)) |at| {
        offset = at + step.len;
        if (offset == haystack.len) return true;
        const next = haystack[offset];
        // Zig build target names are identifiers, so anything outside that set
        // terminates the name.
        if (!std.ascii.isAlphanumeric(next) and next != '_' and next != '.' and next != '-') {
            return true;
        }
    }
    return false;
}

/// Names declared one level inside `build.zig.zon`'s `.tests` block.
fn declaredTestModules(gpa: Allocator, zon: []const u8) ![]const []const u8 {
    const marker = ".tests = .{";
    const start = std.mem.find(u8, zon, marker) orelse return error.NoTestsBlock;

    var modules: std.ArrayList([]const u8) = .empty;
    var depth: isize = 0;
    var lines = std.mem.splitScalar(u8, zon[start + marker.len ..], '\n');
    while (lines.next()) |line| {
        if (depth == 0) {
            const trimmed = std.mem.trim(u8, line, " \t");
            if (std.mem.startsWith(u8, trimmed, ".") and
                std.mem.find(u8, trimmed, "= .{") != null)
            {
                if (std.mem.findScalar(u8, trimmed[1..], ' ')) |end| {
                    try modules.append(gpa, trimmed[1 .. 1 + end]);
                }
            }
        }
        for (line) |c| {
            if (c == '{') depth += 1;
            if (c == '}') depth -= 1;
        }
        if (depth < 0) break; // closed `.tests`
    }
    return modules.items;
}

/// Root source files declared in `build.zig.zon`. The build reaches these
/// directly, so nothing needs to import them.
fn declaredRoots(gpa: Allocator, zon: []const u8) ![]const []const u8 {
    var roots: std.ArrayList([]const u8) = .empty;
    const marker = "root_source_file = \"";
    var rest = zon;
    while (std.mem.find(u8, rest, marker)) |at| {
        rest = rest[at + marker.len ..];
        const end = std.mem.findScalar(u8, rest, '"') orelse break;
        try roots.append(gpa, rest[0..end]);
        rest = rest[end..];
    }
    return roots.items;
}

// -------------------------------------------------------------------------
// Entry point
// -------------------------------------------------------------------------

test "tidy" {
    var arena_state: std.heap.ArenaAllocator = .init(testing.allocator);
    defer arena_state.deinit();
    const arena = arena_state.allocator();
    const io = testing.io;

    var errors: Errors = .{ .gpa = arena };

    const files = try loadRepo(arena, io, &errors);
    const cwd: std.Io.Dir = .cwd();
    const zon = try cwd.readFileAlloc(io, "build.zig.zon", arena, max_file_bytes);
    const ci = try cwd.readFileAlloc(io, ".github/workflows/CI.yml", arena, max_file_bytes);
    const roots = try declaredRoots(arena, zon);

    try tidyTestFileWiring(arena, files, &errors);
    tidyRootTestBlocks(files, &errors);
    try tidyDeadFiles(arena, files, roots, &dead_file_scope, &errors);
    tidyInlineTests(files, &inline_test_scope, &errors);
    tidyErrorValues(files, &errors);
    tidyAllowlists(files, &errors);
    try tidyCiCoverage(arena, zon, ci, &errors);

    if (errors.count > 0) {
        std.debug.print(
            "\n{d} tidy violation(s). See AGENTS.md `Code style` and `Test file layout` " ++
                "for the rules.\n",
            .{errors.count},
        );
        return error.Untidy;
    }
}

// -------------------------------------------------------------------------
// Rule tests
//
// Each feeds a rule synthetic sources and asserts the exact diagnostics, so a
// rule that silently stops catching anything fails here.
// -------------------------------------------------------------------------

const SourceLiteral = struct { []const u8, [:0]const u8 };

/// Builds an in-memory file set so rules can run without touching the repo.
fn analyzeAll(gpa: Allocator, sources: []const SourceLiteral, errors: *Errors) ![]const File {
    var files: std.ArrayList(File) = .empty;
    for (sources) |source| {
        const path, const text = source;
        try files.append(gpa, try analyze(gpa, path, text, errors));
    }
    return files.items;
}

fn expectDiagnostics(actual: []const u8, expected: []const u8) !void {
    try testing.expectEqualStrings(expected, actual);
}

const Fixture = struct {
    arena_state: std.heap.ArenaAllocator,
    captured: std.ArrayList(u8) = .empty,
    errors: Errors = undefined,

    fn init() Fixture {
        return .{ .arena_state = .init(testing.allocator) };
    }

    fn arena(self: *Fixture) Allocator {
        return self.arena_state.allocator();
    }

    fn start(self: *Fixture) *Errors {
        self.errors = .{ .gpa = self.arena(), .captured = &self.captured };
        return &self.errors;
    }

    fn output(self: *Fixture) []const u8 {
        return self.captured.items;
    }

    fn deinit(self: *Fixture) void {
        self.captured.deinit(self.arena());
        self.arena_state.deinit();
    }
};

test "rule: inline test measurement ignores braces in comments and strings" {
    var fixture: Fixture = .init();
    defer fixture.deinit();
    const errors = fixture.start();

    // Line counting by brace depth reads the `{` in this comment as opening a
    // scope and swallows the second test. The AST does not.
    const file = try analyze(fixture.arena(), "demo.zig",
        \\test "one" {
        \\    // start object "{"
        \\    const x = 1;
        \\    _ = x;
        \\}
        \\
        \\test "two" {
        \\    const y = 2;
        \\    _ = y;
        \\}
        \\
    , errors);

    try testing.expectEqual(@as(usize, 2), file.inline_tests.count);
    // 5 lines for the first test, 4 for the second. Brace counting reports one
    // test of 11 lines here, having read the `{` in the comment as a scope.
    try testing.expectEqual(@as(usize, 9), file.inline_tests.lines);
    try testing.expectEqual(@as(usize, 1), file.inline_tests.first_line);
}

test "rule: import collection ignores commented-out imports" {
    var fixture: Fixture = .init();
    defer fixture.deinit();
    const errors = fixture.start();

    const file = try analyze(fixture.arena(), "demo.zig",
        \\const real = @import("real.zig");
        \\// const fake = @import("fake.zig");
        \\const text = "@import(\"quoted.zig\")";
        \\
    , errors);

    try testing.expect(file.importsBasename("real.zig"));
    try testing.expect(!file.importsBasename("fake.zig"));
    try testing.expect(!file.importsBasename("quoted.zig"));
}

test "rule: orphan test file" {
    var fixture: Fixture = .init();
    defer fixture.deinit();
    const errors = fixture.start();

    const files = try analyzeAll(fixture.arena(), &.{
        .{ "src/foo.zig", "pub const x = 1;\n" },
        .{ "src/foo_test.zig", "test \"t\" {}\n" },
    }, errors);
    try tidyTestFileWiring(fixture.arena(), files, errors);

    try expectDiagnostics(fixture.output(),
        \\src/foo_test.zig: error: no `test { _ = @import(...); }` pulls this in, so its tests never run
        \\
    );
}

test "rule: a top-level import does not count as wiring" {
    var fixture: Fixture = .init();
    defer fixture.deinit();
    const errors = fixture.start();

    // Zig never analyses an unreferenced top-level declaration, so this form
    // compiles, looks wired, and runs none of foo_test.zig's tests.
    const files = try analyzeAll(fixture.arena(), &.{
        .{ "src/foo.zig", "const moved_tests = @import(\"foo_test.zig\");\n" },
        .{ "src/foo_test.zig", "test \"t\" {}\n" },
    }, errors);
    try tidyTestFileWiring(fixture.arena(), files, errors);

    try expectDiagnostics(fixture.output(),
        \\src/foo_test.zig: error: no `test { _ = @import(...); }` pulls this in, so its tests never run
        \\
    );
}

test "rule: mutually importing files are still unreachable" {
    var fixture: Fixture = .init();
    defer fixture.deinit();
    const errors = fixture.start();

    // Each has an incoming import, yet neither is reachable from a build root,
    // so neither is compiled and neither one's tests run.
    const files = try analyzeAll(fixture.arena(), &.{
        .{ "src/root.zig", "pub const used = @import(\"used.zig\");\n" },
        .{ "src/used.zig", "pub const x = 1;\n" },
        .{ "src/a.zig", "const b = @import(\"b.zig\");\n" },
        .{ "src/b.zig", "const a = @import(\"a.zig\");\n" },
    }, errors);
    try tidyDeadFiles(fixture.arena(), files, &.{"src/root.zig"}, &.{"src/"}, errors);

    try expectDiagnostics(fixture.output(),
        \\src/a.zig: error: not reachable from any build root
        \\src/b.zig: error: not reachable from any build root
        \\
    );
}

test "rule: imports resolve across directories" {
    var fixture: Fixture = .init();
    defer fixture.deinit();
    const arena = fixture.arena();

    try testing.expectEqualStrings(
        "src/ssz/tree_view/root.zig",
        (try resolveImport(arena, "src/ssz/type", "../tree_view/root.zig")).?,
    );
    try testing.expectEqualStrings(
        "src/clock/config.zig",
        (try resolveImport(arena, "src/clock", "config.zig")).?,
    );
    try testing.expectEqualStrings(
        "src/clock/config.zig",
        (try resolveImport(arena, "src/clock", "./config.zig")).?,
    );
    // A module-name import is resolved by the build, not against the file system.
    try testing.expect((try resolveImport(arena, "src/clock", "persistent_merkle_tree")) == null);
}

test "rule: unpaired test file" {
    var fixture: Fixture = .init();
    defer fixture.deinit();
    const errors = fixture.start();

    const files = try analyzeAll(fixture.arena(), &.{
        .{ "src/root.zig", "test { _ = @import(\"ghost_test.zig\"); }\n" },
        .{ "src/ghost_test.zig", "test \"t\" {}\n" },
    }, errors);
    try tidyTestFileWiring(fixture.arena(), files, errors);

    try expectDiagnostics(fixture.output(),
        \\src/ghost_test.zig: error: no sibling file to pair with, expected src/ghost.zig
        \\
    );
}

test "rule: test file wired from a package root instead of its module" {
    var fixture: Fixture = .init();
    defer fixture.deinit();
    const errors = fixture.start();

    const files = try analyzeAll(fixture.arena(), &.{
        .{ "src/root.zig", "test { _ = @import(\"foo_test.zig\"); }\n" },
        .{ "src/foo.zig", "pub const x = 1;\n" },
        .{ "src/foo_test.zig", "test \"t\" {}\n" },
    }, errors);
    try tidyTestFileWiring(fixture.arena(), files, errors);

    try expectDiagnostics(fixture.output(),
        \\src/foo_test.zig: error: src/foo.zig does not pull it in from a test block, wire it from the module under test
        \\
    );
}

test "rule: TitleCase file pairs with a snake_case test file" {
    var fixture: Fixture = .init();
    defer fixture.deinit();
    const errors = fixture.start();

    const files = try analyzeAll(fixture.arena(), &.{
        .{ "src/Node.zig", "test { _ = @import(\"node_test.zig\"); }\n" },
        .{ "src/node_test.zig", "test \"t\" {}\n" },
    }, errors);
    try tidyTestFileWiring(fixture.arena(), files, errors);

    try expectDiagnostics(fixture.output(), "");
}

test "rule: root.zig without a test block hides sibling tests" {
    var fixture: Fixture = .init();
    defer fixture.deinit();
    const errors = fixture.start();

    // This is the era/root.zig bug: re-exporting a file does not collect its tests.
    const files = try analyzeAll(fixture.arena(), &.{
        .{ "src/era/root.zig", "pub const era = @import(\"era.zig\");\n" },
        .{ "src/era/era.zig", "test \"t\" {}\n" },
    }, errors);
    tidyRootTestBlocks(files, errors);

    try expectDiagnostics(fixture.output(),
        \\src/era/root.zig: error: no test block, but src/era/era.zig has tests that will not run
        \\
    );
}

test "rule: dead file" {
    var fixture: Fixture = .init();
    defer fixture.deinit();
    const errors = fixture.start();

    const files = try analyzeAll(fixture.arena(), &.{
        .{ "src/root.zig", "pub const used = @import(\"used.zig\");\n" },
        .{ "src/used.zig", "pub const x = 1;\n" },
        .{ "src/stray.zig", "pub const y = 2;\n" },
    }, errors);
    try tidyDeadFiles(fixture.arena(), files, &.{"src/root.zig"}, &.{"src/"}, errors);

    try expectDiagnostics(fixture.output(),
        \\src/stray.zig: error: not reachable from any build root
        \\
    );
}

test "rule: a second test block means the tests belong in a _test.zig" {
    var fixture: Fixture = .init();
    defer fixture.deinit();
    const errors = fixture.start();

    // One inline test is a usage example and passes. The wiring block counts
    // too, so a usage example next to an extracted suite is also two blocks.
    const files = try analyzeAll(fixture.arena(), &.{
        .{ "src/example.zig", "pub const x = 1;\ntest \"usage\" {}\n" },
        .{ "src/suite.zig", "pub const x = 1;\ntest \"a\" {}\ntest \"b\" {}\n" },
        .{ "src/mixed.zig", "test \"usage\" {}\ntest { _ = @import(\"mixed_test.zig\"); }\n" },
    }, errors);
    tidyInlineTests(files, &.{"src/"}, errors);

    try expectDiagnostics(fixture.output(),
        \\src/suite.zig:2: error: 2 test blocks, a file holds at most 1; move the tests to a sibling _test.zig
        \\src/mixed.zig:1: error: 2 test blocks, a file holds at most 1; move the tests to a sibling _test.zig
        \\
    );
}

test "rule: stale allowlist entry" {
    var fixture: Fixture = .init();
    defer fixture.deinit();
    const errors = fixture.start();

    // Every allowlisted path is missing from this file set, which is what a
    // deleted or renamed file looks like.
    const files = try analyzeAll(fixture.arena(), &.{
        .{ "src/unrelated.zig", "pub const x = 1;\n" },
    }, errors);
    tidyAllowlists(files, errors);

    try testing.expectEqual(
        inline_test_allowlist.len + unimported_file_allowlist.len,
        errors.count,
    );
    try testing.expect(std.mem.find(
        u8,
        fixture.output(),
        "src/cpu_count.zig: error: allowlisted but the file does not exist",
    ) != null);
}

test "rule: error values named through their set" {
    var fixture: Fixture = .init();
    defer fixture.deinit();
    const errors = fixture.start();

    const files = try analyzeAll(fixture.arena(), &.{
        .{
            "src/demo.zig",
            \\const Node = @import("Node.zig");
            \\pub const DemoError = error{Bad};
            \\pub const Failures = error{Other};
            \\const HttpError = struct { Bad: u8 };
            \\
            \\pub fn a() DemoError!void {
            \\    return DemoError.Bad;
            \\}
            \\
            \\pub fn a2() Failures!void {
            \\    return Failures.Other;
            \\}
            \\
            \\pub fn a3() u8 {
            \\    return HttpError.Bad;
            \\}
            \\
            \\pub fn b() Node.Error!void {
            \\    return Node.Error.InvalidNode;
            \\}
            \\
            \\pub fn c() error{Bad}!void {
            \\    // DemoError.Bad in a comment is prose, not code.
            \\    const text = "DemoError.Bad";
            \\    _ = text;
            \\    _ = Node.Error.init;
            \\    return error.Bad;
            \\}
            \\
        },
    }, errors);
    tidyErrorValues(files, errors);

    // `Node.Error` as a return type is a type, not a value, and a lowercase
    // member is a call rather than an error name.
    try expectDiagnostics(fixture.output(),
        \\src/demo.zig:7: error: `DemoError.Bad` names an error through its set, write `error.Bad`
        \\src/demo.zig:11: error: `Failures.Other` names an error through its set, write `error.Other`
        \\src/demo.zig:19: error: `Error.InvalidNode` names an error through its set, write `error.InvalidNode`
        \\
    );
}

test "rule: a longer target name does not satisfy a shorter one" {
    // `zig build test:ssz` occurs inside `zig build test:ssz_generic_spec_tests`.
    try testing.expect(!containsStep("run: zig build test:ssz_generic_spec_tests\n", "zig build test:ssz"));
    try testing.expect(containsStep("run: zig build test:ssz\n", "zig build test:ssz"));
    try testing.expect(containsStep("run: zig build test:ssz", "zig build test:ssz"));
    try testing.expect(containsStep("zig build test:ssz -Dpreset=minimal\n", "zig build test:ssz"));
}

test "rule: module declared but absent from CI" {
    var fixture: Fixture = .init();
    defer fixture.deinit();
    const errors = fixture.start();

    const zon =
        \\    .tests = .{
        \\        .covered = .{ .root_module = .covered },
        \\        .forgotten = .{ .root_module = .forgotten },
        \\    },
    ;
    const ci = "run: zig build test:covered\n";
    try tidyCiCoverage(fixture.arena(), zon, ci, errors);

    try expectDiagnostics(fixture.output(),
        \\build.zig.zon: error: module `forgotten` has no `zig build test:forgotten` step in CI
        \\
    );
}

test "rule: parse errors are reported, not silently skipped" {
    var fixture: Fixture = .init();
    defer fixture.deinit();
    const errors = fixture.start();

    _ = try analyze(fixture.arena(), "broken.zig", "pub fn oops( {\n", errors);
    try testing.expect(errors.count > 0);
    try testing.expect(std.mem.find(u8, fixture.output(), "broken.zig:1: error:") != null);
}
