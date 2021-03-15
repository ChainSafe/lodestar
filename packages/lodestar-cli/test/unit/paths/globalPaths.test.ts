import {expect} from "chai";
import {getGlobalPaths} from "../../../src/paths/global";

describe("paths / global", () => {
  process.env.XDG_DATA_HOME = "/my-root-dir";
  const defaultRootDir = "/my-root-dir/lodestar/mainnet";

  const testCases: {
    id: string;
    args: Parameters<typeof getGlobalPaths>[0];
    globalPaths: ReturnType<typeof getGlobalPaths>;
  }[] = [
    {
      id: "Default paths",
      args: {},
      globalPaths: {
        rootDir: defaultRootDir,
        paramsFile: "/my-root-dir/lodestar/mainnet/config.yaml",
      },
    },
    {
      id: "Network paths",
      args: {network: "pyrmont"},
      globalPaths: {
        rootDir: "/my-root-dir/lodestar/pyrmont",
        paramsFile: "/my-root-dir/lodestar/pyrmont/config.yaml",
      },
    },
    {
      id: "Custom rootDir",
      args: {rootDir: "./attack-network"},
      globalPaths: {
        rootDir: "./attack-network",
        paramsFile: "attack-network/config.yaml",
      },
    },
    {
      id: "Custom paramsFile",
      args: {paramsFile: "/tmp/custom-config.yaml"},
      globalPaths: {
        rootDir: defaultRootDir,
        paramsFile: "/tmp/custom-config.yaml",
      },
    },
    {
      id: "Custom relative paramsFile",
      args: {paramsFile: "custom-config.yaml"},
      globalPaths: {
        rootDir: defaultRootDir,
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
