import {expect} from "chai";
import {getGlobalPaths} from "../../../src/paths/global";

describe("paths / global", () => {
  const testCases: {
    id: string;
    args: Parameters<typeof getGlobalPaths>[0];
    globalPaths: ReturnType<typeof getGlobalPaths>;
  }[] = [
    {
      id: "Default paths",
      args: {},
      globalPaths: {
        rootDir: "./.lodestar",
        paramsFile: ".lodestar/config.yaml",
      },
    },
    {
      id: "Testnet paths",
      args: {testnet: "medalla"},
      globalPaths: {
        rootDir: ".medalla",
        paramsFile: ".medalla/config.yaml",
      },
    },
    {
      id: "Custom rootDir",
      args: {rootDir: "./attack-testnet"},
      globalPaths: {
        rootDir: "./attack-testnet",
        paramsFile: "attack-testnet/config.yaml",
      },
    },
    {
      id: "Custom paramsFile",
      args: {paramsFile: "/tmp/custom-config.yaml"},
      globalPaths: {
        rootDir: "./.lodestar",
        paramsFile: "/tmp/custom-config.yaml",
      },
    },
    {
      id: "Custom relative paramsFile",
      args: {paramsFile: "custom-config.yaml"},
      globalPaths: {
        rootDir: "./.lodestar",
        paramsFile: ".lodestar/custom-config.yaml",
      },
    },
  ];

  for (const {id, args, globalPaths} of testCases) {
    it(id, () => {
      expect(getGlobalPaths(args)).to.deep.equal(globalPaths);
    });
  }
});
