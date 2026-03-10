import specTestVersions from "../spec-tests-version.json" with {type: "json"};
import path from "node:path";
import {fileURLToPath} from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ethereumConsensusSpecsTests = {
  ...specTestVersions.ethereumConsensusSpecsTests,
  outputDir: path.join(__dirname, "../../", specTestVersions.ethereumConsensusSpecsTests.outputDirBase),
};

export const blsSpecTests = {
  ...specTestVersions.blsSpecTests,
  outputDir: path.join(__dirname, "../../", specTestVersions.blsSpecTests.outputDirBase),
};
