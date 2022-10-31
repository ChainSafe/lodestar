import path from "node:path";
import util from "node:util";
import child from "node:child_process";
import {fileURLToPath} from "node:url";
import {expect, use} from "chai";
import chaiAsPromised from "chai-as-promised";

const scriptNames = {
  ok: "overridePresetOk.ts",
  error: "overridePresetError.ts",
};

use(chaiAsPromised);

const exec = util.promisify(child.exec);

// Global variable __dirname no longer available in ES6 modules.
// Solutions: https://stackoverflow.com/questions/46745014/alternative-for-dirname-in-node-js-when-using-es6-modules
// eslint-disable-next-line @typescript-eslint/naming-convention
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tsNodeBinary = path.join(__dirname, "../../../../node_modules/.bin/ts-node-esm");

describe("Override preset", function () {
  // Allow time for ts-node to compile Typescript source
  this.timeout(30_000);

  it("Should correctly override preset", async () => {
    await exec(`${tsNodeBinary} ${path.join(__dirname, scriptNames.ok)}`);
  });

  it("Should throw trying to override preset in the wrong order", async () => {
    await expect(exec(`${tsNodeBinary} ${path.join(__dirname, scriptNames.error)}`)).to.be.rejectedWith(
      "Lodestar preset is already frozen"
    );
  });
});
