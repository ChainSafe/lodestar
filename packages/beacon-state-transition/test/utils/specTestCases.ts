import path, {join} from "node:path";
import {fileURLToPath} from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const SPEC_TEST_LOCATION = join(__dirname, "../../../../node_modules/@chainsafe/eth2-spec-tests");
