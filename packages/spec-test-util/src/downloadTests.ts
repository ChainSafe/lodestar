import {execFile} from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {Readable, Transform} from "node:stream";
import {pipeline} from "node:stream/promises";
import {ReadableStream as NodeReadableStream} from "node:stream/web";
import {promisify} from "node:util";
import {rimraf} from "rimraf";
import {fetch, retry} from "@lodestar/utils";
import {createDownloadProgressReporter} from "./downloadProgress.js";

export const defaultSpecTestsRepoUrl = "https://github.com/ethereum/consensus-specs";

const logEmpty = (): void => {};
const DOWNLOAD_STATE_DIRNAME = ".download-state";

export type DownloadTestsOptions = {
  specVersion: string;
  outputDir: string;
  /** Root Github URL `https://github.com/ethereum/consensus-specs` */
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

  const {versionFile, stateDir, missingTests, isFullyDownloaded} = prepareOutputDir(
    outputDir,
    specVersion,
    testsToDownload,
    log
  );
  if (isFullyDownloaded) {
    return;
  }

  const progressReporter = createDownloadProgressReporter({
    log,
    enabled: log !== logEmpty,
  });

  const results = await Promise.allSettled(
    missingTests.map(async (test) => {
      const url = `${specTestsRepoUrl ?? defaultSpecTestsRepoUrl}/releases/download/${specVersion}/${test}.tar.gz`;
      await downloadAndExtractArchive({outputDir, stateDir, test, url, progressReporter});
    })
  );

  progressReporter.close();

  for (const result of results) {
    if (result.status === "rejected") {
      throw result.reason;
    }
  }

  fs.writeFileSync(versionFile, specVersion);
}

type PreparedOutputDir = {
  versionFile: string;
  stateDir: string;
  missingTests: string[];
  isFullyDownloaded: boolean;
};

type DownloadAndExtractArchiveOpts = {
  outputDir: string;
  stateDir: string;
  test: string;
  url: string;
  progressReporter: ReturnType<typeof createDownloadProgressReporter>;
};

function prepareOutputDir<TestNames extends string>(
  outputDir: string,
  specVersion: string,
  testsToDownload: TestNames[],
  log: (msg: string) => void
): PreparedOutputDir {
  const versionFile = path.join(outputDir, "version.txt");
  const stateDir = path.join(outputDir, DOWNLOAD_STATE_DIRNAME);
  const outputDirExists = fs.existsSync(outputDir);
  const existingVersion = readExistingVersion(versionFile);
  const stateDirExists = fs.existsSync(stateDir);

  if (existingVersion === specVersion) {
    fs.mkdirSync(stateDir, {recursive: true});

    if (!stateDirExists) {
      for (const test of testsToDownload) {
        fs.closeSync(fs.openSync(getDoneMarkerPath(stateDir, test), "w"));
      }
    }

    const missingTests = testsToDownload.filter((test) => !fs.existsSync(getDoneMarkerPath(stateDir, test)));
    if (missingTests.length === 0) {
      log(`version ${specVersion} already downloaded`);
      return {versionFile, stateDir, missingTests, isFullyDownloaded: true};
    }

    log(`Resuming version ${specVersion}`);
    return {versionFile, stateDir, missingTests, isFullyDownloaded: false};
  }

  log(`Downloading new version ${specVersion}`);
  if (outputDirExists) {
    log(`Cleaning existing version ${existingVersion ?? "unknown"} at ${outputDir}`);
    rimraf.sync(outputDir);
  }

  fs.mkdirSync(stateDir, {recursive: true});
  fs.writeFileSync(versionFile, specVersion);

  return {
    versionFile,
    stateDir,
    missingTests: [...testsToDownload],
    isFullyDownloaded: testsToDownload.length === 0,
  };
}

function readExistingVersion(versionFile: string): string | null {
  if (!fs.existsSync(versionFile)) {
    return null;
  }

  return fs.readFileSync(versionFile, "utf8").trim();
}

function getDoneMarkerPath(stateDir: string, test: string): string {
  return path.join(stateDir, `${encodeURIComponent(test)}.done`);
}

async function downloadAndExtractArchive({
  outputDir,
  stateDir,
  test,
  url,
  progressReporter,
}: DownloadAndExtractArchiveOpts): Promise<void> {
  const tarball = path.join(outputDir, `${test}.tar.gz.part`);
  const doneMarker = getDoneMarkerPath(stateDir, test);
  const label = `${test}.tar.gz`;

  await retry(
    async () => {
      fs.rmSync(tarball, {force: true});

      const res = await fetch(url, {signal: AbortSignal.timeout(30 * 60 * 1000)});
      if (!res.ok) {
        throw new Error(`Failed to download file from ${url}: ${res.status} ${res.statusText}`);
      }

      if (!res.body) {
        throw new Error("Response body is null");
      }

      const totalBytesHeader = res.headers.get("content-length");
      const totalBytes = parseContentLength(totalBytesHeader);
      progressReporter.start(label, totalBytes);

      let transferredBytes = 0;
      const body = Readable.fromWeb(res.body as unknown as NodeReadableStream);
      const progressStream = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          transferredBytes += chunk.length;
          progressReporter.update(label, transferredBytes);
          callback(null, chunk);
        },
      });

      await pipeline(body, progressStream, fs.createWriteStream(tarball));
      progressReporter.downloaded(label, transferredBytes);

      await extractTarball(tarball, outputDir);
      progressReporter.extracted(label, outputDir);

      fs.closeSync(fs.openSync(doneMarker, "w"));
      fs.rmSync(tarball, {force: true});
    },
    {
      retries: 3,
      onRetry: (e, attempt) => {
        progressReporter.retry(label, attempt, e.message);
      },
    }
  );
}

async function extractTarball(tarball: string, outputDir: string): Promise<void> {
  await promisify(execFile)("tar", ["-xzf", tarball, "-C", outputDir, "--exclude=._*", "--exclude=*/._*"], {
    maxBuffer: 1000 * 1024 * 1024, // 1 GB
  });
}

function parseContentLength(contentLengthHeader: string | null): number | null {
  if (contentLengthHeader === null) {
    return null;
  }

  const totalBytes = Number.parseInt(contentLengthHeader, 10);
  return Number.isFinite(totalBytes) && totalBytes > 0 ? totalBytes : null;
}
