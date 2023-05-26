import path from "node:path";
import {fileURLToPath} from "node:url";
import fs from "node:fs";
import {ForkName} from "@lodestar/params";

// Global variable __dirname no longer available in ES6 modules.
// Solutions: https://stackoverflow.com/questions/46745014/alternative-for-dirname-in-node-js-when-using-es6-modules
// eslint-disable-next-line @typescript-eslint/naming-convention
const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("Ensure all named", () => {
  // This test is to prevent developers from diverging from the .named() pattern.
  // Could be achieved with an eslint rule, but this is easier to code with current knowledge.
  it("Ensure all types use Type.named() instead of new Type()", () => {
    const forkDirsPath = path.join(__dirname, "../../src");
    const forkDirs = fs.readdirSync(forkDirsPath);

    if (!forkDirs.includes("phase0")) {
      throw Error("forkDirs must include at least phase0");
    }

    for (const forkDir of forkDirs) {
      if (ForkName[forkDir as ForkName]) {
        const filepath = path.join(forkDirsPath, forkDir, "sszTypes.ts");
        const fileSrc = fs.readFileSync(filepath, "utf8");
        if (fileSrc.includes(" new ")) {
          throw Error(`${filepath} must use Type.named() syntax, not new Type()`);
        }
      }
    }
  });
});

