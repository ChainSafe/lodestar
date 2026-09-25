import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {downloadNightlyTests} from "../../src/downloadNightlyTests.js";
import {downloadGenericSpecTests} from "../../src/downloadTests.js";

vi.mock("../../src/downloadTests.js", () => ({downloadGenericSpecTests: vi.fn()}));

describe("downloadNightlyTests", () => {
  const fetchMock = vi.fn<(url: string | URL, init?: RequestInit) => Promise<Response>>();
  const log = vi.fn<(message: string) => void>();
  const opts = {
    specTestsRepoUrl: "https://github.com/ethereum/consensus-specs",
    outputDir: "/unused/spec-tests",
    testsToDownload: ["minimal"],
  };
  const recentRun = {id: 35671698955, created_at: "2026-09-22T00:00:00Z", head_sha: "recent-sha"};
  const staleRun = {id: 33283281270, created_at: "2026-08-30T00:25:25Z", head_sha: "stale-sha"};
  const artifacts = {
    artifacts: [{name: "minimal.tar.gz", expired: false, archive_download_url: "https://example.com/minimal.zip"}],
  };

  beforeEach(() => {
    vi.useFakeTimers({now: new Date("2026-09-22T06:00:00Z")});
    vi.stubEnv("GITHUB_TOKEN", "test-token");
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it.each(["2026-02-30", "2026-13-01", "2026-9-01"])("rejects invalid date %s before requesting runs", async (date) => {
    await expect(downloadNightlyTests(opts, log, date)).rejects.toThrow(`Invalid date: "${date}"`);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    {name: "stale", runs: [staleRun]},
    {name: "empty", runs: []},
  ])("retries a $name response and downloads today's UTC run", async ({runs}) => {
    fetchMock
      .mockResolvedValueOnce(Response.json({workflow_runs: runs}))
      .mockResolvedValueOnce(Response.json({workflow_runs: [recentRun]}))
      .mockResolvedValueOnce(Response.json(artifacts));

    const assertion = expect(downloadNightlyTests(opts, log, "latest")).resolves.toBeUndefined();
    await Promise.all([assertion, vi.runAllTimersAsync()]);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const query = new URL(fetchMock.mock.calls[0][0]).searchParams;
    expect(query.get("created")).toBe("2026-09-22");
    expect(query.get("event")).toBe("schedule");
    expect(fetchMock.mock.calls[2][0]).toContain(`/runs/${recentRun.id}/artifacts`);
    expect(downloadGenericSpecTests).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({specVersion: `nightly-${recentRun.id}`}),
      log
    );
  });

  it.each([
    {name: "stale", runs: [staleRun], code: "NIGHTLY_RUN_OUTSIDE_DATE_RANGE"},
    {
      name: "yesterday's",
      runs: [{...recentRun, created_at: "2026-09-21T23:59:59.999Z"}],
      code: "NIGHTLY_RUN_OUTSIDE_DATE_RANGE",
    },
    {
      name: "tomorrow's",
      runs: [{...recentRun, created_at: "2026-09-23T00:00:00Z"}],
      code: "NIGHTLY_RUN_OUTSIDE_DATE_RANGE",
    },
    {name: "empty", runs: [], code: "NIGHTLY_RUN_NOT_FOUND"},
  ])("rejects repeated $name responses without requesting artifacts", async ({runs, code}) => {
    fetchMock.mockImplementation(async (url) =>
      Response.json(String(url).includes("/artifacts") ? artifacts : {workflow_runs: runs})
    );

    const assertion = expect(downloadNightlyTests(opts, log, "latest")).rejects.toMatchObject({
      type: {code},
    });
    await Promise.all([assertion, vi.runAllTimersAsync()]);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(downloadGenericSpecTests).not.toHaveBeenCalled();
    for (const [url] of fetchMock.mock.calls) {
      expect(String(url), "must only query workflow runs").not.toContain("/artifacts");
    }
  });

  it("allows historical runs when a date is explicitly requested", async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json({workflow_runs: [staleRun]}))
      .mockResolvedValueOnce(Response.json(artifacts));

    await downloadNightlyTests(opts, log, "2026-08-30");

    const query = new URL(fetchMock.mock.calls[0][0]).searchParams;
    expect(query.get("created")).toBe("2026-08-30");
    expect(query.has("event")).toBe(false);
    expect(downloadGenericSpecTests).toHaveBeenCalledWith(
      expect.objectContaining({specVersion: `nightly-${staleRun.id}`}),
      log
    );
  });
});
