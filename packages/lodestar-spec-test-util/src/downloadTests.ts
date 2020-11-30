import axios from "axios";
import tar from "tar";
import stream from "stream";
import {promisify} from "util";

const BASE_URL = "https://github.com/ethereum/eth2.0-spec-tests/releases/download";

// eslint-disable-next-line prettier/prettier
const TESTS = ["general", "mainnet", "minimal"];

// eslint-disable-next-line @typescript-eslint/no-floating-promises
export async function downloadTests(
  {specVersion, outputDir}: {specVersion: string; outputDir: string},
  log?: (msg: string) => void
): Promise<void> {
  if (log) log(`outputDir = ${outputDir}`);

  await Promise.all(
    TESTS.map(async (test) => {
      const URL = `${BASE_URL}/${specVersion}/${test}.tar.gz`;
      const OUTPUT = `${outputDir}`;

      // download tar
      const {data, headers} = await axios({
        method: "get",
        url: URL,
        responseType: "stream",
      });

      const totalSize = headers["content-length"];
      if (log) log(`Downloading ${URL} - ${totalSize} bytes`);

      // extract tar into output directory
      await promisify(stream.pipeline)(data, tar.x({cwd: OUTPUT}));

      if (log) log(`Downloaded  ${URL}`);
    })
  );
}
