import path from "node:path";
import util from "node:util";
import child from "node:child_process";
import {expect, use} from "chai";
import chaiAsPromised from "chai-as-promised";

const scriptNames = {
  ok: "setPresetOk.ts",
  error: "setPresetError.ts",
};

use(chaiAsPromised);

const exec = util.promisify(child.exec);

const tsNodeBinary = path.join(__dirname, "../../../../node_modules/.bin/ts-node");

describe("setPreset", function () {
  // Allow time for ts-node to compile Typescript source
  this.timeout(30_000);

  it("Should correctly set preset", async () => {
    await exec(`${tsNodeBinary} ${path.join(__dirname, scriptNames.ok)}`);
  });

  it("Should throw trying to set preset in the wrong order", async () => {
    await expect(exec(`${tsNodeBinary} ${path.join(__dirname, scriptNames.error)}`)).to.be.rejectedWith(
      "Lodestar preset is already frozen"
    );
  });
});
