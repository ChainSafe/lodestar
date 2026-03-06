import path from "node:path";
import {fileURLToPath} from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type SpecTestsConfig = {
  specVersion: string;
  outputDir: string;
  specTestsRepoUrl: string;
  testsToDownload: string[];
};

export const ethereumConsensusSpecsTests: SpecTestsConfig = {
  specVersion: "v1.7.0-alpha.2",
  outputDir: path.join(__dirname, "../../spec-tests"),
  specTestsRepoUrl: "https://github.com/ethereum/consensus-specs",
  testsToDownload: ["general", "mainnet", "minimal"],
};
