const std = @import("std");
const raw = @import("raw.zig");
const Allocator = std.mem.Allocator;

pub const Options = struct {
    gt: ?[]const u8 = null,
    gte: ?[]const u8 = null,
    lt: ?[]const u8 = null,
    lte: ?[]const u8 = null,
    reverse: bool = false,
    fill_cache: bool = false,
    keys: bool = true,
    values: bool = true,
    limit: u32 = std.math.maxInt(u32),
};

pub const Range = struct {
    lower: ?[]u8,
    upper: ?[]u8,
    lower_inclusive: bool,
    upper_inclusive: bool,
    reverse: bool,

    pub fn init(allocator: Allocator, options: *const Options, key_limit: usize) !Range {
        for ([_]?[]const u8{ options.gt, options.gte, options.lt, options.lte }) |bound| {
            if (bound) |key| if (key.len > key_limit) return error.KeyTooLarge;
        }
        const lower_bound = options.gte orelse options.gt;
        const upper_bound = options.lte orelse options.lt;
        const lower = if (lower_bound) |key| try allocator.dupe(u8, key) else null;
        errdefer if (lower) |key| allocator.free(key);

        const upper = if (upper_bound) |key| try allocator.dupe(u8, key) else null;
        errdefer if (upper) |key| allocator.free(key);

        return .{
            .lower = lower,
            .upper = upper,
            .lower_inclusive = options.gte != null,
            .upper_inclusive = options.lte != null,
            .reverse = options.reverse,
        };
    }

    pub fn deinit(self: *Range, allocator: Allocator) void {
        if (self.lower) |key| allocator.free(key);
        if (self.upper) |key| allocator.free(key);
        self.* = undefined;
    }

    pub fn seek(self: *const Range, iterator: *raw.Iterator, diagnostics: ?*raw.Diagnostics) !void {
        if (self.reverse) {
            if (self.upper) |upper| {
                iterator.seek(upper);
                try iterator.getError(diagnostics);
                if (!iterator.valid()) {
                    iterator.seekToLast();
                } else {
                    const order = std.mem.order(u8, iterator.key(), upper);
                    if (order == .gt or (order == .eq and !self.upper_inclusive)) iterator.prev();
                }
            } else iterator.seekToLast();
        } else {
            if (self.lower) |lower| {
                iterator.seek(lower);
                try iterator.getError(diagnostics);
                if (iterator.valid() and !self.lower_inclusive and
                    std.mem.eql(u8, iterator.key(), lower)) iterator.next();
            } else iterator.seekToFirst();
        }
        try iterator.getError(diagnostics);
    }

    pub fn seekTarget(self: *const Range, iterator: *raw.Iterator, target: []const u8, diagnostics: ?*raw.Diagnostics) !bool {
        if (!self.contains(target)) return false;
        iterator.seek(target);
        try iterator.getError(diagnostics);
        if (self.reverse) {
            if (!iterator.valid()) {
                iterator.seekToLast();
            } else if (std.mem.order(u8, iterator.key(), target) == .gt) iterator.prev();
        }
        try iterator.getError(diagnostics);
        return true;
    }

    pub fn contains(self: *const Range, key: []const u8) bool {
        if (self.lower) |lower| {
            const order = std.mem.order(u8, key, lower);
            if (order == .lt or (order == .eq and !self.lower_inclusive)) return false;
        }
        if (self.upper) |upper| {
            const order = std.mem.order(u8, key, upper);
            if (order == .gt or (order == .eq and !self.upper_inclusive)) return false;
        }
        return true;
    }

    pub fn advance(self: *const Range, iterator: *raw.Iterator, diagnostics: ?*raw.Diagnostics) !void {
        std.debug.assert(iterator.valid());
        if (self.reverse) iterator.prev() else iterator.next();
        try iterator.getError(diagnostics);
    }
};
