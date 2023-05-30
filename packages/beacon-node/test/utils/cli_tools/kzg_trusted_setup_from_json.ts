import fs from "node:fs";
import {TrustedSetupJSON, trustedSetupJsonToBin, TRUSTED_SETUP_BIN_FILEPATH} from "../../../src/util/kzg.js";

// CLI TOOL: Use to transform a JSON trusted setup into .ssz
//
// Note: Closer to DENEB this tool may never be useful again,
//       see https://github.com/ethereum/c-kzg-4844/issues/3

const INPUT_FILE = process.argv[2];
if (!INPUT_FILE) throw Error("no INPUT_FILE");

const json = JSON.parse(fs.readFileSync(INPUT_FILE, "utf8")) as TrustedSetupJSON;

const bytes = trustedSetupJsonToBin(json);

fs.writeFileSync(TRUSTED_SETUP_BIN_FILEPATH, bytes);
