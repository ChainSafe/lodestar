import path from "node:path";
import {fileURLToPath} from "node:url";
import {loadTrustedSetup, transformTrustedSetupJSON} from "c-kzg";

// Global variable __dirname no longer available in ES6 modules.
// Solutions: https://stackoverflow.com/questions/46745014/alternative-for-dirname-in-node-js-when-using-es6-modules
// eslint-disable-next-line @typescript-eslint/naming-convention
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const trustedSetupFilepath = path.join(__dirname, "../../trusted_setup.json");

/**
 * Load our KZG trusted setup into C-KZG for later use
 */
export async function loadEthereumTrustedSetup(): Promise<void> {
  try {
    const file = await transformTrustedSetupJSON(trustedSetupFilepath);
    loadTrustedSetup(file);
  } catch (e) {
    (e as Error).message = `Error loading trusted setup ${trustedSetupFilepath}: ${(e as Error).message}`;
    throw e;
  }
}
