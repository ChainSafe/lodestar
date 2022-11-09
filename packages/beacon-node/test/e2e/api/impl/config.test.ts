import fetch from "cross-fetch";
import {ForkName, activePreset} from "@lodestar/params";
import {chainConfig} from "@lodestar/config/default";
import {ethereumConsensusSpecsTests} from "../../../spec/specTestVersioning.js";
import {specConstants} from "../../../../src/api/impl/config/constants.js";

const CONSTANT_NAMES_SKIP_LIST = new Set([
  // This constant is an array, so it's skipped due to not being just a string.
  // This constant can also be derived from existing constants so it's not critical.
  // PARTICIPATION_FLAG_WEIGHTS = [TIMELY_SOURCE_WEIGHT, TIMELY_TARGET_WEIGHT, TIMELY_HEAD_WEIGHT]
  "PARTICIPATION_FLAG_WEIGHTS",
]);

describe("api / impl / config", function () {
  this.timeout(60 * 1000);

  it("Ensure all constants are exposed", async () => {
    const constantNames = await downloadRemoteConstants(ethereumConsensusSpecsTests.specVersion);

    const constantsInCode = new Set([
      // Constants for API only
      ...Object.keys(specConstants),
      // Full preset
      ...Object.keys(activePreset),
      // Full config
      ...Object.keys(chainConfig),
    ]);

    const missingConstants: string[] = [];

    for (const constantName of constantNames) {
      if (!constantsInCode.has(constantName) && !CONSTANT_NAMES_SKIP_LIST.has(constantName)) {
        missingConstants.push(constantName);
      }
    }

    if (missingConstants.length > 0) {
      throw Error(
        "Some constants delcared in consensus-specs repo are not exposed in API:\n" + missingConstants.join("\n")
      );
    }
  });
});

async function downloadRemoteConstants(commit: string): Promise<string[]> {
  const downloadedSpecs: Promise<string>[] = [];

  for (const forkName of Object.values(ForkName)) {
    // If some future fork does not specify one of this docs, refactor to fetch some docs only on some forks
    for (const docName of ["beacon-chain.md", "validator.md"]) {
      downloadedSpecs.push(
        fetch(
          `https://raw.githubusercontent.com/ethereum/consensus-specs/${commit}/specs/${forkName}/${docName}`
        ).then((res) => res.text())
      );
    }
  }

  const constantNames: string[] = [];

  for (const spec of await Promise.all(downloadedSpecs)) {
    const matches = spec.matchAll(/\|\s`*([A-Z_]+)`\s\|/g);
    for (const match of matches) {
      constantNames.push(match[1]);
    }
  }

  return constantNames;
}
