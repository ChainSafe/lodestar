import {spawn} from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {pipeline} from "node:stream/promises";
import {ReadableStream as NodeReadableStream} from "node:stream/web";
import {fetch, retry} from "@lodestar/utils";
import {rimraf} from "rimraf";

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
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 30 * 60 * 1000);

          const res = await fetch(url, {signal: controller.signal}).finally(() => clearTimeout(timeout));

          if (!res.ok) {
            throw new Error(`Failed to download file from ${url}: ${res.status} ${res.statusText}`);
          }

          if (!res.body) {
            throw new Error("Response body is null");
          }

          const totalSize = res.headers.get("content-length") as string;
          log(`Downloading ${url} - ${totalSize} bytes`);

          await pipeline(res.body as NodeReadableStream, fs.createWriteStream(tarball));
          log(`Downloaded ${url} - ${fs.statSync(tarball).size} bytes`);

          await new Promise<void>((resolve, reject) => {
            const extractor = spawn("tar", ["-xzf", tarball, "-C", outputDir], {stdio: "inherit"});
            extractor.on("error", reject);
            extractor.on("close", (code) =>
              code === 0 ? (log(`Extracted  ${tarball}`), resolve()) : reject(new Error(`tar exited with code ${code}`))
            );
          });

          fs.unlinkSync(tarball);
        },
        {
          retries: 3,
          onRetry: (e, attempt) => {
            log(`Download attempt ${attempt} for ${url} failed: ${e.message}`);
          },
        }
      );
    })
  );

  fs.writeFileSync(versionFile, specVersion);
}
