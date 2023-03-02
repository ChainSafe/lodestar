import path from "node:path";
import {fileURLToPath} from "node:url";

// Global variable __dirname no longer available in ES6 modules.
// Solutions: https://stackoverflow.com/questions/46745014/alternative-for-dirname-in-node-js-when-using-es6-modules
// eslint-disable-next-line @typescript-eslint/naming-convention
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const SPEC_TEST_LOCATION = path.join(__dirname, "../../../../node_modules/@chainsafe/eth2-spec-tests");
