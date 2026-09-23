import {LodestarError, fetch, retry} from "@lodestar/utils";
import {downloadGenericSpecTests} from "./downloadTests.js";

const MAX_NIGHTLY_AGE_MS = 48 * 60 * 60 * 1000;

type WorkflowRun = {id: number; created_at: string; head_sha: string};
type WorkflowRunsResponse = {workflow_runs: WorkflowRun[]};
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

async function resolveNightlyRun(
  repo: string,
  token: string,
  log: (msg: string) => void,
  date?: string,
  branch?: string
): Promise<WorkflowRun> {
  const params = new URLSearchParams({status: "success", per_page: "1"});
  if (branch) params.append("branch", branch);
  // If neither branch nor date narrow the query, restrict to scheduled runs so
  // a PR's successful run on consensus-specs can't outrank the latest master
  // nightly. When a date is given, allow manual re-runs on that day too.
  else if (!date) params.append("event", "schedule");
  const minCreatedAt = date ? Date.parse(date) : Date.now() - MAX_NIGHTLY_AGE_MS;
  const maxCreatedAt = date ? minCreatedAt + 24 * 60 * 60 * 1000 : Infinity;
  const createdFilter = date ?? `>=${new Date(minCreatedAt).toISOString()}`;
  params.append("created", createdFilter);

  return retry(
    async () => {
      const {workflow_runs} = await ghApiFetch<WorkflowRunsResponse>(
        `/repos/${repo}/actions/workflows/tests.yml/runs?${params}`,
        token
      );
      const run = workflow_runs[0];
      if (!run) {
        throw new LodestarError(
          {code: "NIGHTLY_RUN_NOT_FOUND", repo, branch: branch ?? null, createdFilter},
          `No successful run found for ${repo}${branch ? ` (${branch})` : ""} with created=${createdFilter}`
        );
      }

      // GitHub's run listing can return weeks-old results, so validate even with a date filter.
      const createdAt = Date.parse(run.created_at);
      if (!(createdAt >= minCreatedAt && createdAt < maxCreatedAt)) {
        throw new LodestarError(
          {
            code: "NIGHTLY_RUN_OUTSIDE_DATE_RANGE",
            runId: run.id,
            createdAt: run.created_at ?? null,
            createdFilter,
          },
          `Refusing nightly run ${run.id} created at ${run.created_at}: expected created=${createdFilter}`
        );
      }
      return run;
    },
    {
      retries: 2,
      retryDelay: 1000,
      shouldRetry: (error) => error instanceof LodestarError,
      onRetry: (error, attempt) => log(`Nightly lookup attempt ${attempt}: ${error.message}`),
    }
  );
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
  const run = await resolveNightlyRun(repo, token, log, resolvedDate, opts.branch);
  const runId = run.id;
  log(
    `Resolved nightly${resolvedDate ? ` ${resolvedDate}` : ""} to run ${runId} (created_at=${run.created_at}, head_sha=${run.head_sha})`
  );

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
