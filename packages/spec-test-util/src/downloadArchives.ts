import {execFile} from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {pipeline} from "node:stream/promises";
import {ReadableStream as NodeReadableStream} from "node:stream/web";
import {promisify} from "node:util";
import {fetch, retry} from "@lodestar/utils";
import {specFixturesDir} from "./fixtures.js";

export type DownloadArchivesOptions = {
  /** Directory under {@link specFixturesDir} that receives one subdirectory per archive. */
  version: string;
  /** Gzip tarball URL by archive name. */
  archives: Record<string, string>;
  fetchInit?: RequestInit;
};

/**
 * Extracts each archive into `<specFixturesDir>/<version>/<name>`, matching the layout written by
 * `zig build run:download_spec_tests`. An archive extracts into a staging directory that is renamed
 * into place once complete, so an interrupted download never passes as done.
 */
export async function downloadArchives(
  {version, archives, fetchInit}: DownloadArchivesOptions,
  log: (msg: string) => void
): Promise<void> {
  await Promise.all(
    Object.entries(archives).map(async ([name, url]) => {
      const outDir = path.join(specFixturesDir, version, name);
      if (fs.existsSync(outDir)) return log(`already downloaded ${outDir}`);

      const stagingDir = `${outDir}.extracting`;
      await retry(
        async () => {
          fs.rmSync(stagingDir, {recursive: true, force: true});
          fs.mkdirSync(stagingDir, {recursive: true});

          const res = await fetch(url, {signal: AbortSignal.timeout(30 * 60 * 1000), ...fetchInit});
          if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status} ${res.statusText}`);
          if (!res.body) throw new Error(`Empty response body from ${url}`);

          log(`Downloading ${url} - ${res.headers.get("content-length")} bytes`);
          const tarball = path.join(stagingDir, `${name}.tar.gz`);
          await pipeline(res.body as unknown as NodeReadableStream, fs.createWriteStream(tarball));
          await promisify(execFile)("tar", ["-xzf", tarball, "-C", stagingDir, "--exclude=._*", "--exclude=*/._*"], {
            maxBuffer: 1000 * 1024 * 1024,
          });
          fs.unlinkSync(tarball);
        },
        {retries: 3, onRetry: (e, attempt) => log(`Download attempt ${attempt} for ${name} failed: ${e.message}`)}
      );
      fs.renameSync(stagingDir, outDir);
      log(`Extracted ${url} to ${outDir}`);
    })
  );
}
