const std = @import("std");
const testing = std.testing;
const github_actions = @import("github_actions.zig");

const today: github_actions.Day = "2026-09-22".*;
const recent_run: github_actions.Run = .{ .id = 35671698955, .created_at = "2026-09-22T00:00:00Z", .head_sha = "recent-sha" };
const stale_run: github_actions.Run = .{ .id = 33283281270, .created_at = "2026-08-30T00:25:25Z", .head_sha = "stale-sha" };

test "parseDay rejects dates that do not round-trip" {
    for ([_][]const u8{ "2026-02-30", "2026-13-01", "2026-9-01", "2026-00-10", "2026/09/01", "20260901", "2025-02-29" }) |text| {
        try testing.expectError(error.InvalidDate, github_actions.parseDay(text));
    }
}

test "parseDay accepts calendar days" {
    try testing.expectEqualStrings("2026-04-14", &try github_actions.parseDay("2026-04-14"));
    try testing.expectEqualStrings("2024-02-29", &try github_actions.parseDay("2024-02-29"));
}

test "dayFromEpochSeconds formats the UTC day" {
    try testing.expectEqualStrings("2026-09-22", &github_actions.dayFromEpochSeconds(1790056800));
    try testing.expectEqualStrings("2024-02-29", &github_actions.dayFromEpochSeconds(1709251199));
    try testing.expectEqualStrings("2026-12-31", &github_actions.dayFromEpochSeconds(1798675200));
}

test "runsQuery restricts latest lookups to scheduled runs" {
    const query = try github_actions.runsQuery(testing.allocator, today, null, true);
    defer testing.allocator.free(query);
    try testing.expectEqualStrings("status=success&per_page=1&event=schedule&created=2026-09-22", query);
}

test "runsQuery allows manual reruns on an explicit date" {
    const query = try github_actions.runsQuery(testing.allocator, today, null, false);
    defer testing.allocator.free(query);
    try testing.expectEqualStrings("status=success&per_page=1&created=2026-09-22", query);
}

test "runsQuery filters by branch instead of event" {
    const query = try github_actions.runsQuery(testing.allocator, today, "dev", true);
    defer testing.allocator.free(query);
    try testing.expectEqualStrings("status=success&per_page=1&branch=dev&created=2026-09-22", query);
}

test "selectRun takes today's run" {
    const run = try github_actions.selectRun(&.{recent_run}, today);
    try testing.expectEqual(recent_run.id, run.id);
}

test "selectRun rejects runs outside the requested day" {
    const cases = [_]github_actions.Run{
        stale_run,
        .{ .id = 1, .created_at = "2026-09-21T23:59:59.999Z", .head_sha = "" },
        .{ .id = 2, .created_at = "2026-09-23T00:00:00Z", .head_sha = "" },
        .{ .id = 3, .created_at = "", .head_sha = "" },
    };
    for (cases) |run| {
        try testing.expectError(error.NightlyRunOutsideDateRange, github_actions.selectRun(&.{run}, today));
    }
}

test "selectRun reports an empty listing" {
    try testing.expectError(error.NightlyRunNotFound, github_actions.selectRun(&.{}, today));
}

test "selectRun accepts a historical run on its own day" {
    const run = try github_actions.selectRun(&.{stale_run}, "2026-08-30".*);
    try testing.expectEqual(stale_run.id, run.id);
}

test "findArtifact skips expired and foreign artifacts" {
    const artifacts = [_]github_actions.Artifact{
        .{ .name = "minimal.tar.gz", .archive_download_url = "https://example.com/old.zip", .expired = true },
        .{ .name = "minimal.tar.gz", .archive_download_url = "https://example.com/minimal.zip", .expired = false },
        .{ .name = "general.tar.gz", .archive_download_url = "https://example.com/general.zip", .expired = false },
    };
    try testing.expectEqualStrings("https://example.com/minimal.zip", github_actions.findArtifact(&artifacts, "minimal.tar.gz").?);
    try testing.expectEqual(null, github_actions.findArtifact(&artifacts, "mainnet.tar.gz"));
}

test "parseRuns and parseArtifacts read the API shape" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const runs = try github_actions.parseRuns(arena.allocator(),
        \\{"total_count": 1, "workflow_runs": [{"id": 35671698955, "created_at": "2026-09-22T00:00:00Z", "head_sha": "recent-sha", "status": "completed"}]}
    );
    try testing.expectEqual(1, runs.len);
    try testing.expectEqual(recent_run.id, runs[0].id);
    try testing.expectEqualStrings(recent_run.created_at, runs[0].created_at);

    const artifacts = try github_actions.parseArtifacts(arena.allocator(),
        \\{"artifacts": [{"name": "general.tar.gz", "archive_download_url": "https://example.com/general.zip", "expired": false, "size_in_bytes": 1}]}
    );
    try testing.expectEqual(1, artifacts.len);
    try testing.expectEqualStrings("general.tar.gz", artifacts[0].name);
}
