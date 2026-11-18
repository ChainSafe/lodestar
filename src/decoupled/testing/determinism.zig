//! Determinism rules for the node code: the files that run unchanged under the simulator and in a
//! client. Replay by seed holds only while that code takes time, randomness and I/O from its
//! dependencies, and one stray call breaks it without failing any other test.
//! testing/, roguestar.zig and *_test.zig files are outside the rules.
const std = @import("std");
const Token = std.zig.Token;

/// Every node file, relative to the module root. A relative import of a file missing from this
/// list is a violation, so the list is closed under import and cannot fall behind the code.
pub const node_files = [_][]const u8{
    "root.zig",
    "Node.zig",
    "types.zig",
    "limits.zig",
    "ac/available_chain.zig",
    "ac/VoteSet.zig",
    "fg/FinalityGadget.zig",
    "fg/ChainState.zig",
    "fg/SigningRecord.zig",
    "fg/AttestationPool.zig",
    "fg/FinalityFrame.zig",
    "fg/finality_types.zig",
};

/// The export point. It alone may import from testing/.
const root_file = "root.zig";

/// Named modules the node code may import. Their code is outside these rules and is reviewed by
/// hand: bounded_array is a fixed buffer with a count.
const allowed_modules = [_][]const u8{ "std", "bounded_array" };

pub const Rule = enum {
    /// Time comes from the Clock dependency.
    clock,
    /// No draw may bypass the seed, and std's generators may change between Zig versions.
    randomness,
    /// Thread scheduling is not replayable.
    threads,
    /// Files, sockets, processes and the environment are reached through dependencies. In Zig 0.16
    /// std.Io also carries the clock and the thread pool.
    io,
    /// A hash map iterates in an order set by std's hash function and the map's growth history.
    /// Neither is protocol state, and std may change the first.
    unordered_iteration,
    /// Addresses differ between runs.
    pointer_value,
    /// C code is outside these rules.
    c_import,
    /// std under another name would hide its uses from the namespace rules.
    std_alias,
    foreign_import,
    testing_import,
    unlisted_file,

    fn message(rule: Rule) []const u8 {
        return switch (rule) {
            .clock => "clock read; take time from the Clock dependency",
            .randomness => "randomness; the node code draws nothing",
            .threads => "thread use; the node code is single-threaded",
            .io => "direct I/O or environment access; go through a dependency",
            .unordered_iteration => "hash map; use an ordered container",
            .pointer_value => "address used as a value",
            .c_import => "C import",
            .std_alias => "std imported under another name",
            .foreign_import => "import of a module that is not allowed in node code",
            .testing_import => "import from testing/ outside root.zig",
            .unlisted_file => "import of a file missing from node_files",
        };
    }
};

const Namespace = struct { name: []const u8, rule: Rule };
const banned_namespaces = [_]Namespace{
    .{ .name = "time", .rule = .clock },
    .{ .name = "Random", .rule = .randomness },
    .{ .name = "Thread", .rule = .threads },
    .{ .name = "Io", .rule = .io },
    .{ .name = "fs", .rule = .io },
    .{ .name = "net", .rule = .io },
    .{ .name = "http", .rule = .io },
    .{ .name = "posix", .rule = .io },
    .{ .name = "os", .rule = .io },
    .{ .name = "c", .rule = .io },
    .{ .name = "process", .rule = .io },
    .{ .name = "hash_map", .rule = .unordered_iteration },
};

pub const Counts = std.enums.EnumArray(Rule, u32);

/// Count the violations in one file. `path` is relative to the module root and decides how
/// relative imports resolve. With `report`, each violation is printed as `path:line: error: ...`.
pub fn check(path: []const u8, source: [:0]const u8, report: bool) Counts {
    var counts = Counts.initFill(0);
    var tokenizer = std.zig.Tokenizer.init(source);
    var before: [2]Token = @splat(.{ .tag = .invalid, .loc = .{ .start = 0, .end = 0 } });
    while (true) {
        const token = tokenizer.next();
        if (token.tag == .eof) break;
        var ahead = tokenizer;
        const rule: ?Rule = switch (token.tag) {
            .identifier => stdRule(source, &before, token, &ahead),
            .builtin => builtinRule(path, source, &before, token, &ahead),
            else => null,
        };
        if (rule) |found| {
            counts.getPtr(found).* += 1;
            if (report) {
                const line = 1 + std.mem.count(u8, source[0..token.loc.start], "\n");
                std.debug.print("src/decoupled/{s}:{d}: error: {s}\n", .{ path, line, found.message() });
            }
        }
        before = .{ before[1], token };
    }
    return counts;
}

fn text(source: []const u8, token: Token) []const u8 {
    return source[token.loc.start..token.loc.end];
}

/// `std.<name>` for a banned name, and `std.crypto.random`.
fn stdRule(source: []const u8, before: *const [2]Token, token: Token, ahead: *std.zig.Tokenizer) ?Rule {
    if (!std.mem.eql(u8, text(source, token), "std") or before[1].tag == .period) return null;
    if (ahead.next().tag != .period) return null;
    const member = ahead.next();
    if (member.tag != .identifier) return null;
    const name = text(source, member);
    for (banned_namespaces) |banned| {
        if (std.mem.eql(u8, name, banned.name)) return banned.rule;
    }
    if (std.mem.indexOf(u8, name, "HashMap") != null and std.mem.indexOf(u8, name, "ArrayHashMap") == null) {
        return .unordered_iteration;
    }
    if (std.mem.eql(u8, name, "crypto") and ahead.next().tag == .period) {
        const inner = ahead.next();
        if (inner.tag == .identifier and std.mem.eql(u8, text(source, inner), "random")) return .randomness;
    }
    return null;
}

fn builtinRule(
    path: []const u8,
    source: []const u8,
    before: *const [2]Token,
    token: Token,
    ahead: *std.zig.Tokenizer,
) ?Rule {
    const name = text(source, token);
    if (std.mem.eql(u8, name, "@intFromPtr")) return .pointer_value;
    if (std.mem.eql(u8, name, "@cImport")) return .c_import;
    if (!std.mem.eql(u8, name, "@import")) return null;
    if (ahead.next().tag != .l_paren) return .foreign_import;
    const argument = ahead.next();
    if (argument.tag != .string_literal) return .foreign_import;
    const quoted = text(source, argument);
    const literal = quoted[1 .. quoted.len - 1];
    if (std.mem.endsWith(u8, literal, ".zig")) return fileRule(path, literal);
    if (std.mem.eql(u8, literal, "std")) {
        const bound_to_std = before[1].tag == .equal and before[0].tag == .identifier and
            std.mem.eql(u8, text(source, before[0]), "std");
        return if (bound_to_std) null else .std_alias;
    }
    for (allowed_modules) |module| {
        if (std.mem.eql(u8, literal, module)) return null;
    }
    return .foreign_import;
}

/// A relative import must land on a test file, on a listed node file, or, from root.zig only,
/// in testing/.
fn fileRule(path: []const u8, import: []const u8) ?Rule {
    if (std.mem.endsWith(u8, import, "_test.zig")) return null;
    var dir = std.fs.path.dirname(path) orelse "";
    var rest = import;
    while (std.mem.startsWith(u8, rest, "../")) {
        if (dir.len == 0) return .unlisted_file;
        dir = std.fs.path.dirname(dir) orelse "";
        rest = rest[3..];
    }
    if (inDirectory(dir, rest, "testing")) {
        return if (std.mem.eql(u8, path, root_file)) null else .testing_import;
    }
    for (node_files) |file| {
        if (dir.len == 0 and std.mem.eql(u8, file, rest)) return null;
        if (dir.len > 0 and file.len == dir.len + 1 + rest.len and std.mem.startsWith(u8, file, dir) and
            file[dir.len] == '/' and std.mem.endsWith(u8, file, rest)) return null;
    }
    return .unlisted_file;
}

/// Whether `dir/rest` lies under the top-level directory `top`.
fn inDirectory(dir: []const u8, rest: []const u8, comptime top: []const u8) bool {
    if (dir.len == 0) return std.mem.startsWith(u8, rest, top ++ "/");
    return std.mem.eql(u8, dir, top) or std.mem.startsWith(u8, dir, top ++ "/");
}

test {
    _ = @import("determinism_test.zig");
}
