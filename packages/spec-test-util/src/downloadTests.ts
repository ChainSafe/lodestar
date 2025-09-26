import {execFile} from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {pipeline} from "node:stream/promises";
import {ReadableStream as NodeReadableStream} from "node:stream/web";
import {promisify} from "node:util";
import {rimraf} from "rimraf";
import {fetch, retry} from "@lodestar/utils";

export const defaultSpecTestsRepoUrl = "https://github.com/ethereum/consensus-spec-tests";

const logEmpty = (): void => {};

export type DownloadTestsOptions = {
  specVersion: string;
  outputDir: string;
  /** Root Github URL `https://github.com/ethereum/consensus-spec-tests` */
  specTestsRepoUrl: string;
  /** Release files names to download without prefix `["general", "mainnet", "minimal"]` */
  testsToDownload: string[];
};

export interface DownloadGenericTestsOptions<TestNames extends string> {
  specVersion: string;
  outputDir: string;
  specTestsRepoUrl: string;
  testsToDownload: TestNames[];
}

/**
 * Download spec tests
 */
export async function downloadTests(opts: DownloadTestsOptions, log: (msg: string) => void = logEmpty): Promise<void> {
  await downloadGenericSpecTests(opts, log);
}

/**
 * Generic Github release downloader.
 * Used by spec tests and SlashingProtectionInterchangeTest
 */
export async function downloadGenericSpecTests<TestNames extends string>(
  {specVersion, specTestsRepoUrl, outputDir, testsToDownload}: DownloadGenericTestsOptions<TestNames>,
  log: (msg: string) => void = logEmpty
): Promise<void> {
  log(`outputDir = ${outputDir}`);

  // Use version.txt as a flag to prevent re-downloading the tests
  const versionFile = path.join(outputDir, "version.txt");
  const existingVersion = fs.existsSync(versionFile) && fs.readFileSync(versionFile, "utf8").trim();

  if (existingVersion === specVersion) {
    return log(`version ${specVersion} already downloaded`);
  }
  log(`Downloading new version ${specVersion}`);

  if (fs.existsSync(outputDir)) {
    log(`Cleaning existing version ${existingVersion} at ${outputDir}`);
    rimraf.sync(outputDir);
  }

  fs.mkdirSync(outputDir, {recursive: true});

  await Promise.all(
    testsToDownload.map(async (test) => {
      const url = `${specTestsRepoUrl ?? defaultSpecTestsRepoUrl}/releases/download/${specVersion}/${test}.tar.gz`;
      const tarball = path.join(outputDir, `${test}.tar.gz`);

      await retry(
        async () => {
          const res = await fetch(url, {signal: AbortSignal.timeout(30 * 60 * 1000)});

          if (!res.ok) {
            throw new Error(`Failed to download file from ${url}: ${res.status} ${res.statusText}`);
          }

          if (!res.body) {
            throw new Error("Response body is null");
          }

          const totalSize = res.headers.get("content-length");
          log(`Downloading ${url} - ${totalSize} bytes`);

          // stream download to local .tar.gz file
          await pipeline(res.body as unknown as NodeReadableStream, fs.createWriteStream(tarball));
          log(`Downloaded ${url} - ${fs.statSync(tarball).size} bytes`);

          // extract tar into output directory
          await promisify(execFile)("tar", ["-xzf", tarball, "-C", outputDir, "--exclude=._*", "--exclude=*/._*"], {
            maxBuffer: 1000 * 1024 * 1024, // 1 GB
          });
          log(`Extracted ${tarball} to ${outputDir}`);

          fs.unlinkSync(tarball);
        },
        {
          retries: 3,
          onRetry: (e, attempt) => {
            log(`Download attempt ${attempt} for ${url} failed: ${e.message}`);
          },
        }
      );

      // download tar
    })
  );

  fs.writeFileSync(versionFile, specVersion);
}
