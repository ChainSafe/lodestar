import {execFile} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {pipeline} from "node:stream/promises";
import {ReadableStream as NodeReadableStream} from "node:stream/web";
import {promisify} from "node:util";
import {fetch, retry} from "@lodestar/utils";
import {defaultSpecTestsRepoUrl} from "./downloadTests.js";

const logEmpty = (): void => {};

export type DownloadComptestsOptions = {
  specVersion: string;
  /** Shared spec-tests output dir, the same one the standard downloader extracts into */
  outputDir: string;
  /** Root Github URL `https://github.com/ethereum/consensus-specs` */
  specTestsRepoUrl?: string;
  fetchInit?: RequestInit;
};

// Same convention as the standard downloader's version.txt, scoped to the comptests asset
const MARKER_FILENAME = "comptests-version.txt";
const COMPTESTS_SUBDIR = "fork_choice_compliance";

/**
 * Download the fork-choice compliance test vectors (`comptests.tar.gz` release asset,
 * consensus-specs #5334) into the shared spec-tests directory.
 *
 * The standard downloader (`downloadGenericSpecTests`) deletes its ENTIRE output directory on a
 * cache miss, so it cannot be pointed at the shared dir for a second asset. This downloader is
 * asset-scoped instead:
 * - extracts into a temporary directory first,
 * - replaces only comptest-owned paths (`tests/<preset>/<fork>/fork_choice_compliance/`),
 * - never deletes the shared output directory,
 * - writes its own marker (`comptests-version.txt`) only after a successful merge, so a failed
 *   download/extraction leaves existing fixtures and marker untouched.
 *
 * Note: a standard-tests version change wipes the whole shared dir including these vectors
 * (correct — new pin needs new vectors); the `test:comptest` zero-test guard catches the absence.
 */
export async function downloadComptests(
  {specVersion, outputDir, specTestsRepoUrl, fetchInit}: DownloadComptestsOptions,
  log: (msg: string) => void = logEmpty
): Promise<void> {
  log(`outputDir = ${outputDir}`);

  const markerPath = path.join(outputDir, MARKER_FILENAME);
  if (readMarkerVersion(markerPath) === specVersion) {
    return log(`comptests version ${specVersion} already downloaded`);
  }

  const url = `${specTestsRepoUrl ?? defaultSpecTestsRepoUrl}/releases/download/${specVersion}/comptests.tar.gz`;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lodestar-comptests-"));

  try {
    await retry(
      async () => {
        const res = await fetch(url, {signal: AbortSignal.timeout(30 * 60 * 1000), ...fetchInit});
        if (!res.ok) {
          throw new Error(`Failed to download file from ${url}: ${res.status} ${res.statusText}`);
        }
        if (!res.body) {
          throw new Error("Response body is null");
        }

        log(`Downloading ${url} - ${res.headers.get("content-length")} bytes`);
        const tarball = path.join(tmpDir, "comptests.tar.gz");
        await pipeline(res.body as unknown as NodeReadableStream, fs.createWriteStream(tarball));
        log(`Downloaded ${url} - ${fs.statSync(tarball).size} bytes`);

        await promisify(execFile)("tar", ["-xzf", tarball, "-C", tmpDir, "--exclude=._*", "--exclude=*/._*"], {
          maxBuffer: 1000 * 1024 * 1024, // 1 GB
        });
        log(`Extracted ${tarball}`);
        fs.unlinkSync(tarball);
      },
      {
        retries: 3,
        onRetry: (e, attempt) => {
          log(`Download attempt ${attempt} for comptests failed: ${e.message}`);
        },
      }
    );

    // Validate the extraction BEFORE touching the shared dir — tar can exit 0 on a truncated
    // archive, and removing existing fixtures against an empty extraction would destroy them.
    const extracted = findComptestDirs(tmpDir);
    if (extracted.length === 0) {
      throw new Error(`No ${COMPTESTS_SUBDIR} directories found in comptests.tar.gz from ${url}`);
    }

    // Remove ALL existing comptest-owned paths so forks dropped upstream leave no stale cases
    for (const dir of findComptestDirs(outputDir)) {
      fs.rmSync(dir, {recursive: true, force: true});
    }
    for (const srcDir of extracted) {
      const destDir = path.join(outputDir, path.relative(tmpDir, srcDir));
      fs.mkdirSync(path.dirname(destDir), {recursive: true});
      fs.cpSync(srcDir, destDir, {recursive: true});
      log(`Installed ${path.relative(outputDir, destDir)}`);
    }

    // Marker written only after a fully successful merge
    fs.writeFileSync(markerPath, specVersion);
    log(`comptests ${specVersion} ready`);
  } finally {
    fs.rmSync(tmpDir, {recursive: true, force: true});
  }
}

function readMarkerVersion(markerPath: string): string | null {
  if (!fs.existsSync(markerPath)) return null;
  return fs.readFileSync(markerPath, "utf8").trim();
}

/** Find all `tests/<preset>/<fork>/fork_choice_compliance` dirs under `root` */
function findComptestDirs(root: string): string[] {
  const found: string[] = [];
  const testsDir = path.join(root, "tests");
  if (!fs.existsSync(testsDir)) return found;
  for (const preset of fs.readdirSync(testsDir)) {
    const presetDir = path.join(testsDir, preset);
    if (!fs.statSync(presetDir).isDirectory()) continue;
    for (const fork of fs.readdirSync(presetDir)) {
      const complianceDir = path.join(presetDir, fork, COMPTESTS_SUBDIR);
      if (fs.existsSync(complianceDir) && fs.statSync(complianceDir).isDirectory()) {
        found.push(complianceDir);
      }
    }
  }
  return found;
}
