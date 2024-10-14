import path from "node:path";
import util from "node:util";
import child from "node:child_process";
import {fileURLToPath} from "node:url";
import {describe, it, expect, vi} from "vitest";

const scriptNames = {
  ok: "overridePresetOk.ts",
  error: "overridePresetError.ts",
};

const exec = util.promisify(child.exec);

// Global variable __dirname no longer available in ES6 modules.
// Solutions: https://stackoverflow.com/questions/46745014/alternative-for-dirname-in-node-js-when-using-es6-modules
const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("Override preset", () => {
  // Allow time for ts-node to compile Typescript source
  vi.setConfig({testTimeout: 30_000});

  it("Should correctly override preset", async () => {
    // `LODESTAR_PRESET` must not be set to properly test preset override
    if (process.env.LODESTAR_PRESET) delete process.env.LODESTAR_PRESET;

    await exec(`node --loader ts-node/esm ${path.join(__dirname, scriptNames.ok)}`);
  });

  it("Should throw trying to override preset in the wrong order", async () => {
    await expect(exec(`node --loader ts-node/esm ${path.join(__dirname, scriptNames.error)}`)).rejects.toThrow(
      "Lodestar preset is already frozen"
    );
  });
});
