//! Run and artifact selection for consensus-specs nightly downloads, kept free of I/O so the
//! rules can be tested against canned GitHub API responses.
const std = @import("std");
const Allocator = std.mem.Allocator;

pub const Run = struct {
    id: u64,
    created_at: []const u8,
    head_sha: []const u8,
};

pub const Artifact = struct {
    name: []const u8,
    archive_download_url: []const u8,
    expired: bool,
};

/// A UTC calendar day as `YYYY-MM-DD`.
pub const Day = [10]u8;

pub const DayError = error{InvalidDate};

/// Accepts exactly the days that `new Date(text).toISOString()` reproduces as `text`.
pub fn parseDay(text: []const u8) DayError!Day {
    if (text.len != 10 or text[4] != '-' or text[7] != '-') return error.InvalidDate;
    const year = parseDigits(text[0..4]) orelse return error.InvalidDate;
    const month = parseDigits(text[5..7]) orelse return error.InvalidDate;
    const day = parseDigits(text[8..10]) orelse return error.InvalidDate;
    if (month < 1 or month > 12 or day < 1) return error.InvalidDate;
    const days_in_month = std.time.epoch.getDaysInMonth(@intCast(year), @enumFromInt(month));
    if (day > days_in_month) return error.InvalidDate;
    return text[0..10].*;
}

fn parseDigits(text: []const u8) ?u16 {
    var value: u16 = 0;
    for (text) |c| {
        if (c < '0' or c > '9') return null;
        value = value * 10 + (c - '0');
    }
    return value;
}

pub fn dayFromEpochSeconds(seconds: u64) Day {
    const epoch_seconds: std.time.epoch.EpochSeconds = .{ .secs = seconds };
    const year_day = epoch_seconds.getEpochDay().calculateYearDay();
    const month_day = year_day.calculateMonthDay();
    var day: Day = undefined;
    _ = std.fmt.bufPrint(&day, "{d:0>4}-{d:0>2}-{d:0>2}", .{
        year_day.year,
        @intFromEnum(month_day.month),
        month_day.day_index + 1,
    }) catch unreachable;
    return day;
}

/// Query for the latest successful `tests.yml` run on `day`.
///
/// Without a branch or an explicit date, only scheduled runs qualify so that a pull request's
/// successful run on consensus-specs cannot outrank the master nightly. With a date, manual reruns
/// on that day count too.
pub fn runsQuery(allocator: Allocator, day: Day, branch: ?[]const u8, latest: bool) ![]u8 {
    var query: std.ArrayList(u8) = .empty;
    errdefer query.deinit(allocator);
    try query.appendSlice(allocator, "status=success&per_page=1");
    if (branch) |name| {
        try query.appendSlice(allocator, "&branch=");
        try query.print(allocator, "{f}", .{std.fmt.alt(std.Uri.Component{ .raw = name }, .formatEscaped)});
    } else if (latest) {
        try query.appendSlice(allocator, "&event=schedule");
    }
    try query.appendSlice(allocator, "&created=");
    try query.appendSlice(allocator, &day);
    return query.toOwnedSlice(allocator);
}

pub const SelectRunError = error{ NightlyRunNotFound, NightlyRunOutsideDateRange };

/// GitHub's run listing can return weeks-old results even with a `created` filter, so the first
/// run must have been created on `day`.
pub fn selectRun(runs: []const Run, day: Day) SelectRunError!Run {
    if (runs.len == 0) return error.NightlyRunNotFound;
    const run = runs[0];
    if (run.created_at.len < day.len or !std.mem.eql(u8, run.created_at[0..day.len], &day)) {
        return error.NightlyRunOutsideDateRange;
    }
    return run;
}

/// Download URL of the unexpired artifact called `name`, if the run produced one.
pub fn findArtifact(artifacts: []const Artifact, name: []const u8) ?[]const u8 {
    for (artifacts) |artifact| {
        if (!artifact.expired and std.mem.eql(u8, artifact.name, name)) return artifact.archive_download_url;
    }
    return null;
}

/// The parsed values borrow from `arena`.
pub fn parseRuns(arena: Allocator, json: []const u8) ![]const Run {
    const Response = struct { workflow_runs: []const Run };
    const parsed = try std.json.parseFromSliceLeaky(Response, arena, json, .{ .ignore_unknown_fields = true });
    return parsed.workflow_runs;
}

/// The parsed values borrow from `arena`.
pub fn parseArtifacts(arena: Allocator, json: []const u8) ![]const Artifact {
    const Response = struct { artifacts: []const Artifact };
    const parsed = try std.json.parseFromSliceLeaky(Response, arena, json, .{ .ignore_unknown_fields = true });
    return parsed.artifacts;
}

test {
    _ = @import("github_actions_test.zig");
}
