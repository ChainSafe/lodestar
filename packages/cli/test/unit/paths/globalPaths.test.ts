import {expect} from "chai";
import {getGlobalPaths} from "../../../src/paths/global.js";

describe("paths / global", () => {
  process.env.XDG_DATA_HOME = "/my-root-dir";
  const defaultDataDir = "/my-root-dir/lodestar/mainnet";

  const testCases: {
    id: string;
    args: Parameters<typeof getGlobalPaths>[0];
    globalPaths: ReturnType<typeof getGlobalPaths>;
  }[] = [
    {
      id: "Default paths",
      args: {},
      globalPaths: {
        dataDir: defaultDataDir,
        paramsFile: undefined,
      },
    },
    {
      id: "Network paths",
      args: {network: "goerli"},
      globalPaths: {
        dataDir: "/my-root-dir/lodestar/goerli",
        paramsFile: undefined,
      },
    },
    {
      id: "Custom dataDir",
      args: {dataDir: "./attack-network"},
      globalPaths: {
        dataDir: "./attack-network",
        paramsFile: undefined,
      },
    },
    {
      id: "Custom paramsFile",
      args: {paramsFile: "/tmp/custom-config.yaml"},
      globalPaths: {
        dataDir: defaultDataDir,
        paramsFile: "/tmp/custom-config.yaml",
      },
    },
    {
      id: "Custom relative paramsFile",
      args: {paramsFile: "custom-config.yaml"},
      globalPaths: {
        dataDir: defaultDataDir,
        paramsFile: "custom-config.yaml",
      },
    },
  ];

  for (const {id, args, globalPaths} of testCases) {
    it(id, () => {
      expect(getGlobalPaths(args)).to.deep.equal(globalPaths);
    });
  }
});
