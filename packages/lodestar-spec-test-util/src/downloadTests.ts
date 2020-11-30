import fs from "fs";
import path from "path";
import rimraf from "rimraf";
import axios from "axios";
import tar from "tar";
import stream from "stream";
import {promisify} from "util";

const BASE_URL = "https://github.com/ethereum/eth2.0-spec-tests/releases/download";

// eslint-disable-next-line prettier/prettier
const TESTS = ["general", "mainnet", "minimal"];

interface IDownloadTestsOptions {
  specVersion: string;
  outputDir: string;
  cleanup?: boolean;
  force?: boolean;
}

export async function downloadTestsAndManage(
  {specVersion, outputDir: outputDirBase, cleanup, force}: IDownloadTestsOptions,
  log?: (msg: string) => void
): Promise<void> {
  const outputDir = path.join(outputDirBase, specVersion);
  if (log) log(`outputDir = ${outputDir}`);

  if (fs.existsSync(outputDir) && !force) {
    throw Error(`Path ${outputDir} already exists`);
  } else {
    fs.mkdirSync(outputDir, {recursive: true});
  }

  if (cleanup) {
    for (const dirpath of fs.readdirSync(outputDir)) {
      if (dirpath !== specVersion) {
        rimraf.sync(path.join(outputDir, dirpath));
      }
    }
  }

  await downloadTests({specVersion, outputDir});
}

async function downloadTests(
  {specVersion, outputDir}: IDownloadTestsOptions,
  log?: (msg: string) => void
): Promise<void> {
  if (log) log(`outputDir = ${outputDir}`);

  await Promise.all(
    TESTS.map(async (test) => {
      const url = `${BASE_URL}/${specVersion}/${test}.tar.gz`;

      // download tar
      const {data, headers} = await axios({
        method: "get",
        url,
        responseType: "stream",
      });

      const totalSize = headers["content-length"];
      if (log) log(`Downloading ${URL} - ${totalSize} bytes`);

      // extract tar into output directory
      await promisify(stream.pipeline)(data, tar.x({cwd: outputDir}));

      if (log) log(`Downloaded  ${URL}`);
    })
  );
}
