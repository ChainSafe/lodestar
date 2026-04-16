import {fetch} from "@lodestar/utils";
import {downloadGenericSpecTests} from "./downloadTests.js";

type WorkflowRunsResponse = {workflow_runs: {id: number}[]};
type ArtifactsListResponse = {artifacts: {archive_download_url: string; expired: boolean; name: string}[]};

async function ghApiFetch<T>(endpoint: string, token: string): Promise<T> {
  const res = await fetch(`https://api.github.com${endpoint}`, {
    headers: {Authorization: `token ${token}`, Accept: "application/vnd.github+json"},
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    throw new Error(
      res.status === 401 ? "GITHUB_TOKEN is invalid or expired" : `GitHub API ${res.status} (${endpoint})`
    );
  }

  return res.json() as Promise<T>;
}

async function resolveNightlyRunId(repo: string, token: string, date?: string, branch?: string): Promise<number> {
  const params = new URLSearchParams({status: "success", per_page: "1"});
  if (branch) params.append("branch", branch);
  if (date) params.append("created", date);

  const { workflow_runs } = await ghApiFetch<WorkflowRunsResponse>(
    `/repos/${repo}/actions/workflows/tests.yml/runs?${params}`,
    token
  );

  const runId = workflow_runs[0]?.id;
  if (!runId) {
    throw new Error(`No successful run found${date ? ` on ${date}` : ""} for ${repo}${branch ? ` (${branch})` : ""}`);
  }
  return runId;
}

export async function downloadNightlyTests(
  opts: {specTestsRepoUrl: string; outputDir: string; testsToDownload: string[]; branch?: string},
  log: (msg: string) => void,
  date?: string
): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is required for nightly downloads");

  const resolvedDate = date === "latest" || !date ? undefined : date;
  if (resolvedDate && !/^\d{4}-\d{2}-\d{2}$/.test(resolvedDate)) {
    throw new Error(`Invalid date: "${date}". Expected "latest" or YYYY-MM-DD`);
  }

  const repo = new URL(opts.specTestsRepoUrl).pathname.slice(1).replace(/\/$/, "");
  const runId = await resolveNightlyRunId(repo, token, resolvedDate, opts.branch);
  log(`Resolved nightly${resolvedDate ? ` ${resolvedDate}` : ""} to run ${runId}`);

  const {artifacts} = await ghApiFetch<ArtifactsListResponse>(`/repos/${repo}/actions/runs/${runId}/artifacts`, token);

  const urlByTest: Record<string, string> = {};
  const available: string[] = [];
  for (const test of opts.testsToDownload) {
    const artifact = artifacts.find((a) => a.name === `${test}.tar.gz` && !a.expired);
    if (artifact) {
      urlByTest[test] = artifact.archive_download_url;
      available.push(test);
    } else {
      log(`Skipping ${test} (not found in run ${runId})`);
    }
  }

  if (available.length === 0) throw new Error(`No matching artifacts found in run ${runId}`);

  const authInit: RequestInit = {headers: {Authorization: `token ${token}`, Accept: "application/vnd.github+json"}};

  await downloadGenericSpecTests(
    {
      specVersion: `nightly-${runId}`,
      specTestsRepoUrl: opts.specTestsRepoUrl,
      outputDir: opts.outputDir,
      testsToDownload: available,
      testUrls: urlByTest,
      fetchInit: authInit,
    },
    log
  );
}
