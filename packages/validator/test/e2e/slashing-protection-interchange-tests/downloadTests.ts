/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/naming-convention */
import fs from "fs";
import path from "path";
import rimraf from "rimraf";
import axios from "axios";
import tar from "tar";
import stream from "stream";
import {promisify} from "util";

export type TestToDownload = "eip-3076-tests";
export const defaultTestsToDownload: TestToDownload[] = ["eip-3076-tests"];
export const defaultSpecTestsRepoUrl = "https://github.com/eth2-clients/slashing-protection-interchange-tests";

export interface IDownloadTestsOptions {
  specTestsRepoUrl?: string;
  specVersion: string;
  outputDir: string;
  testsToDownload?: TestToDownload[];
}

export interface ISlashingProtectionInterchangeTest {
  name: string;
  genesis_validators_root: string;
  steps: [
    {
      should_succeed: boolean;
      interchange: any;
      blocks: {
        pubkey: string;
        should_succeed: boolean;
        slot: string;
        signing_root?: string;
      }[];
      attestations: {
        pubkey: string;
        should_succeed: boolean;
        source_epoch: string;
        target_epoch: string;
        signing_root?: string;
      }[];
    }
  ];
}

export function loadTestCases(testsPath: string): ISlashingProtectionInterchangeTest[] {
  const files = fs.readdirSync(testsPath);
  if (files.length === 0) {
    throw Error(`Not tests found in ${testsPath}`);
  }
  return files.map(
    (file) => JSON.parse(fs.readFileSync(path.join(testsPath, file), "utf8")) as ISlashingProtectionInterchangeTest
  );
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
      const url = `${
        specTestsRepoUrl ?? defaultSpecTestsRepoUrl
      }/releases/download/${specVersion}/${test}-${specVersion}.tar.gz`;

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
