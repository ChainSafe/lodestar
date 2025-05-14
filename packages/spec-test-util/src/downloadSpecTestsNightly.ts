import fs from "node:fs";
import path from "node:path";
import stream from "node:stream";
import {promisify} from "node:util";
import {retry} from "@lodestar/utils";
import axios from "axios";
import extractZip from "extract-zip";
import {rimraf} from "rimraf";

export const defaultSpecTestsRepoUrl = "https://github.com/ethereum/consensus-specs";

const logEmpty = (): void => {};

export interface DownloadNightlyTestsOptions {
  outputDir: string;
  specTestsRepoUrl: string;
  testsToDownload: string[];
}

// Map of test types to their artifact names in GitHub Actions
const TEST_TYPE_TO_ARTIFACT_NAME: Record<string, string> = {
  general: "General Test Configuration",
  mainnet: "Mainnet Test Configuration",
  minimal: "Minimal Test Configuration",
};

function getGithubHeaders() {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
  };
  if (process.env.GITHUB_TOKEN) {
    headers["Authorization"] = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return headers;
}

// Get the latest nightly build number and its artifacts from GitHub Actions
async function getLatestNightlyBuildInfo(
  repoUrl: string,
  log: (msg: string) => void
): Promise<{runNumber: string; artifacts: {name: string; downloadUrl: string}[]}> {
  const apiUrl = repoUrl.replace("github.com", "api.github.com/repos");

  // Get the latest successful run
  log(`Fetching workflow runs from ${apiUrl}/actions/workflows/generate_vectors.yml/runs`);
  const {data: runsData} = await axios.get(`${apiUrl}/actions/workflows/generate_vectors.yml/runs`, {
    headers: getGithubHeaders(),
  });

  log(`Found ${runsData.workflow_runs.length} workflow runs`);
  const latestRun = runsData.workflow_runs.find((run: any) => run.conclusion === "success");
  if (!latestRun) {
    throw new Error("No successful nightly build found");
  }

  log(`Latest successful run: ${latestRun.id} (${latestRun.run_number})`);

  // Get artifacts for this run
  log(`Fetching artifacts for run ${latestRun.id}`);
  const {data: artifactsData} = await axios.get(`${apiUrl}/actions/runs/${latestRun.id}/artifacts`, {
    headers: getGithubHeaders(),
  });

  log(
    `Found ${artifactsData.artifacts.length} artifacts: ${artifactsData.artifacts.map((a: any) => a.name).join(", ")}`
  );

  return {
    runNumber: latestRun.run_number.toString(),
    artifacts: artifactsData.artifacts.map((artifact: any) => ({
      name: artifact.name,
      downloadUrl: artifact.archive_download_url,
    })),
  };
}

// Download nightly generated spec tests
export async function downloadNightlyTests(
  opts: DownloadNightlyTestsOptions,
  log: (msg: string) => void = logEmpty
): Promise<void> {
  log(`outputDir = ${opts.outputDir}`);

  // Get the latest nightly build info
  const {runNumber, artifacts} = await getLatestNightlyBuildInfo(opts.specTestsRepoUrl, log);
  log(`Found latest nightly build: ${runNumber}`);

  // Use build number as version to prevent re-downloading
  const versionFile = path.join(opts.outputDir, "version.txt");
  const existingVersion = fs.existsSync(versionFile) && fs.readFileSync(versionFile, "utf8").trim();

  if (existingVersion === runNumber) {
    return log(`Nightly build ${runNumber} already downloaded`);
  }
  log(`Downloading new nightly build ${runNumber}`);

  if (fs.existsSync(opts.outputDir)) {
    log(`Cleaning existing version ${existingVersion} at ${opts.outputDir}`);
    rimraf.sync(opts.outputDir);
  }

  fs.mkdirSync(opts.outputDir, {recursive: true});

  // Filter artifacts to only download requested tests
  const artifactsToDownload = artifacts.filter((artifact) =>
    opts.testsToDownload.some((testType) => TEST_TYPE_TO_ARTIFACT_NAME[testType] === artifact.name)
  );
  log(`Will download ${artifactsToDownload.length} artifacts: ${artifactsToDownload.map((a) => a.name).join(", ")}`);

  await Promise.all(
    artifactsToDownload.map(async (artifact) => {
      await retry(
        async () => {
          log(`Downloading artifact ${artifact.name} from ${artifact.downloadUrl}`);
          const {data, headers} = await axios({
            method: "get",
            url: artifact.downloadUrl,
            responseType: "stream",
            timeout: 30 * 60 * 1000,
            headers: getGithubHeaders(),
          });

          const totalSize = headers["content-length"] as string;
          log(`Downloading ${artifact.name} - ${totalSize} bytes`);

          // Save the ZIP file temporarily
          const zipPath = path.join(opts.outputDir, `${artifact.name}.zip`);
          const writer = fs.createWriteStream(zipPath);
          await promisify(stream.pipeline)(data, writer);

          // Extract the ZIP file
          log(`Extracting ${artifact.name}...`);
          try {
            await extractZip(zipPath, {dir: opts.outputDir});
            log(`Extraction of ${artifact.name} completed successfully.`);
          } catch (error: unknown) {
            if (error instanceof Error) {
              log(`Error extracting ${artifact.name}: ${error.message}`);
            } else {
              log(`Error extracting ${artifact.name}: ${String(error)}`);
            }
            throw error;
          }

          // Clean up the temporary ZIP file
          fs.unlinkSync(zipPath);

          log(`Downloaded and extracted ${artifact.name}`);
        },
        {
          retries: 3,
          onRetry: (e: Error, attempt: number) => {
            log(`Download attempt ${attempt} for ${artifact.name} failed: ${e.message}`);
          },
        }
      );
    })
  );

  fs.writeFileSync(versionFile, runNumber);
}

// Main function to execute the download
async function main(): Promise<void> {
  const log = (msg: string): void => {
    console.log(msg);
  };

  try {
    await downloadNightlyTests(
      {
        outputDir: "packages/spec-tests-nightly",
        specTestsRepoUrl: defaultSpecTestsRepoUrl,
        testsToDownload: ["general", "mainnet", "minimal"],
      },
      log
    );
  } catch (error) {
    console.error("Failed to download nightly tests:", error);
    process.exit(1);
  }
}

main();
