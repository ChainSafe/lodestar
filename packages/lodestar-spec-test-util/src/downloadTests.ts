import axios from "axios";
import tar from "tar";

const BASE_URL = "https://github.com/ethereum/eth2.0-spec-tests/releases/download";

// eslint-disable-next-line prettier/prettier
const TESTS = ["general", "mainnet", "minimal"];

// eslint-disable-next-line @typescript-eslint/no-floating-promises
export async function downloadTests({specVersion, outputDir}: {specVersion: string; outputDir: string}): Promise<void> {
  await Promise.all(
    TESTS.map(async (test) => {
      const URL = `${BASE_URL}/${specVersion}/${test}.tar.gz`;
      const OUTPUT = `${outputDir}`;
      // download tar
      const {data} = await axios({
        method: "get",
        url: URL,
        responseType: "stream",
      });

      // extract tar into output directory
      data.pipe(tar.x({cwd: OUTPUT}));
    })
  );
}
