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
  const recentRun = {id: 35671698955, created_at: "2026-09-22T00:22:43Z", head_sha: "recent-sha"};
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

  it("bounds latest lookups and logs the selected run's date and commit", async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json({workflow_runs: [recentRun]}))
      .mockResolvedValueOnce(Response.json(artifacts));

    await downloadNightlyTests(opts, log, "latest");

    const query = new URL(fetchMock.mock.calls[0][0]).searchParams;
    expect(query.get("created")).toBe(">=2026-09-20T06:00:00.000Z");
    expect(query.get("event")).toBe("schedule");
    expect(log).toHaveBeenCalledWith(expect.stringContaining(recentRun.created_at));
    expect(log).toHaveBeenCalledWith(expect.stringContaining(recentRun.head_sha));
    expect(downloadGenericSpecTests).toHaveBeenCalledWith(
      expect.objectContaining({specVersion: `nightly-${recentRun.id}`}),
      log
    );
  });

  it.each([
    {name: "stale", runs: [staleRun]},
    {name: "empty", runs: []},
  ])("retries a $name response before downloading artifacts", async ({runs}) => {
    fetchMock
      .mockResolvedValueOnce(Response.json({workflow_runs: runs}))
      .mockResolvedValueOnce(Response.json({workflow_runs: [recentRun]}))
      .mockResolvedValueOnce(Response.json(artifacts));

    const assertion = expect(downloadNightlyTests(opts, log, "latest")).resolves.toBeUndefined();
    await Promise.all([assertion, vi.runAllTimersAsync()]);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2][0]).toContain(`/runs/${recentRun.id}/artifacts`);
    expect(downloadGenericSpecTests).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({specVersion: `nightly-${recentRun.id}`}),
      log
    );
  });

  it.each([
    {name: "stale", createdAt: staleRun.created_at},
    {name: "invalid", createdAt: "not-a-date"},
    {name: "missing", createdAt: undefined},
  ])("rejects repeatedly $name timestamps without requesting artifacts", async ({createdAt}) => {
    fetchMock.mockImplementation(async (url) =>
      Response.json(
        String(url).includes("/artifacts") ? artifacts : {workflow_runs: [{...staleRun, created_at: createdAt}]}
      )
    );

    const assertion = expect(downloadNightlyTests(opts, log, "latest")).rejects.toMatchObject({
      type: {code: "NIGHTLY_RUN_OUTSIDE_DATE_RANGE"},
    });
    await Promise.all([assertion, vi.runAllTimersAsync()]);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(downloadGenericSpecTests).not.toHaveBeenCalled();
    for (const [url] of fetchMock.mock.calls) {
      expect(String(url), "must only query workflow runs").not.toContain("/artifacts");
    }
  });

  it("allows yesterday's successful run", async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json({workflow_runs: [{...recentRun, created_at: "2026-09-21T00:24:52Z"}]}))
      .mockResolvedValueOnce(Response.json(artifacts));

    await downloadNightlyTests(opts, log, "latest");

    expect(downloadGenericSpecTests).toHaveBeenCalledOnce();
  });

  it("allows historical runs when a date is explicitly requested", async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json({workflow_runs: [staleRun]}))
      .mockResolvedValueOnce(Response.json(artifacts));

    await downloadNightlyTests({...opts, branch: "master"}, log, "2026-08-30");

    const query = new URL(fetchMock.mock.calls[0][0]).searchParams;
    expect(query.get("created")).toBe("2026-08-30");
    expect(query.get("branch")).toBe("master");
    expect(query.has("event")).toBe(false);
    expect(downloadGenericSpecTests).toHaveBeenCalledWith(
      expect.objectContaining({specVersion: `nightly-${staleRun.id}`}),
      log
    );
  });

  it("rejects runs outside an explicitly requested date", async () => {
    fetchMock.mockImplementation(async () => Response.json({workflow_runs: [staleRun]}));

    const assertion = expect(downloadNightlyTests(opts, log, "2026-09-21")).rejects.toMatchObject({
      type: {code: "NIGHTLY_RUN_OUTSIDE_DATE_RANGE"},
    });
    await Promise.all([assertion, vi.runAllTimersAsync()]);

    expect(downloadGenericSpecTests).not.toHaveBeenCalled();
  });

  it("does not retry authentication failures", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, {status: 401}));

    await expect(downloadNightlyTests(opts, log, "latest")).rejects.toThrow("GITHUB_TOKEN is invalid or expired");

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(downloadGenericSpecTests).not.toHaveBeenCalled();
  });
});
