/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
import fs from "node:fs";
import path from "node:path";
import stream from "node:stream";
import {promisify} from "node:util";
import rimraf from "rimraf";
import axios from "axios";
import tar from "tar";
import retry from "async-retry";

export const defaultSpecTestsRepoUrl = "https://github.com/ethereum/consensus-spec-tests";

// eslint-disable-next-line @typescript-eslint/no-empty-function
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
  } else {
    log(`Downloading new version ${specVersion}`);
  }

  if (fs.existsSync(outputDir)) {
    log(`Cleaning existing version ${existingVersion} at ${outputDir}`);
    rimraf.sync(outputDir);
  }

  fs.mkdirSync(outputDir, {recursive: true});

  await Promise.all(
    testsToDownload.map(async (test) => {
      const url = `${specTestsRepoUrl ?? defaultSpecTestsRepoUrl}/releases/download/${specVersion}/${test}.tar.gz`;

      await retry(
        // async (bail) => {
        async () => {
          const {data, headers} = await axios({
            method: "get",
            url,
            responseType: "stream",
            timeout: 30 * 60 * 1000,
          });

          const totalSize = headers["content-length"];
          log(`Downloading ${url} - ${totalSize} bytes`);

          // extract tar into output directory
          await promisify(stream.pipeline)(data, tar.x({cwd: outputDir}));

          log(`Downloaded  ${url}`);
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
