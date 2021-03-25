/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
import fs from "fs";
import path from "path";
import rimraf from "rimraf";
import axios from "axios";
import tar from "tar";
import stream from "stream";
import {promisify} from "util";

export type TestToDownload = "general" | "mainnet" | "minimal";
export const defaultTestsToDownload: TestToDownload[] = ["general", "mainnet", "minimal"];
export const defaultSpecTestsRepoUrl = "https://github.com/ethereum/eth2.0-spec-tests";

export interface IDownloadTestsOptions {
  specTestsRepoUrl?: string;
  specVersion: string;
  outputDir: string;
  testsToDownload?: TestToDownload[];
}

export async function downloadTests(
  {specVersion, specTestsRepoUrl, outputDir, testsToDownload = defaultTestsToDownload}: IDownloadTestsOptions,
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  log: (msg: string) => void = () => {}
): Promise<void> {
  log(`outputDir = ${outputDir}`);

  // Use version.txt as a flag to prevent re-downloading the tests
  const versionFile = path.join(outputDir, "version.txt");
  const existingVersion = fs.existsSync(versionFile) && fs.readFileSync(versionFile, "utf8").trim();

  if (existingVersion && existingVersion === specVersion) {
    return log(`version ${specVersion} already downloaded`);
  }

  if (fs.existsSync(outputDir)) {
    log(`Cleaning ${outputDir}`);
    rimraf.sync(outputDir);
  }

  fs.mkdirSync(outputDir, {recursive: true});

  await Promise.all(
    testsToDownload.map(async (test) => {
      const url = `${specTestsRepoUrl ?? defaultSpecTestsRepoUrl}/releases/download/${specVersion}/${test}.tar.gz`;

      // download tar
      const {data, headers} = await axios({
        method: "get",
        url,
        responseType: "stream",
      });

      const totalSize = headers["content-length"];
      log(`Downloading ${url} - ${totalSize} bytes`);

      // extract tar into output directory
      await promisify(stream.pipeline)(data, tar.x({cwd: outputDir}));

      log(`Downloaded  ${url}`);
    })
  );

  fs.writeFileSync(versionFile, specVersion);
}
