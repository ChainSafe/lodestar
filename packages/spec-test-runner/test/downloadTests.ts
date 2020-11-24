import axios from "axios";
import tar from "tar";

import {SPEC_TEST_LOCATION} from "./utils/specTestCases";

// CHANGE THIS to update the spec test version
const SPEC_VERSION = "v1.0.0";
// CHANGE THIS to update the output directory
const OUTPUT_DIR = SPEC_TEST_LOCATION;

const BASE_URL = "https://github.com/ethereum/eth2.0-spec-tests/releases/download";

// eslint-disable-next-line prettier/prettier
const TESTS = [
  "general",
  "mainnet",
  "minimal",
];

// eslint-disable-next-line @typescript-eslint/no-floating-promises
(async function (): Promise<void> {
  await Promise.all(
    TESTS.map((test) => {
      const URL = `${BASE_URL}/${SPEC_VERSION}/${test}.tar.gz`;
      const OUTPUT = `${OUTPUT_DIR}`;
      // download tar
      return axios({
        method: "get",
        url: URL,
        responseType: "stream",
      }).then((resp) => {
        // extract tar into output directory
        resp.data.pipe(tar.x({cwd: OUTPUT}));
      });
    })
  );
})();
