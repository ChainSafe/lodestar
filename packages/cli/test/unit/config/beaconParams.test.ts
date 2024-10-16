import fs from "node:fs";
import {describe, it, expect, beforeAll, afterAll} from "vitest";
import yaml from "js-yaml";
import {toHexString} from "@chainsafe/ssz";
import {getTestdirPath} from "../../utils.js";
import {getBeaconParams} from "../../../src/config/index.js";

describe("config / beaconParams", () => {
  const GENESIS_FORK_VERSION_MAINNET = "0x00000000";
  const GENESIS_FORK_VERSION_HOLESKY = "0x01017000";
  const GENESIS_FORK_VERSION_FILE = "0x00009902";
  const GENESIS_FORK_VERSION_CLI = "0x00009903";
  const networkName = "holesky";
  const paramsFilepath = getTestdirPath("./test-config.yaml");

  const testCases: {
    id: string;
    kwargs: Parameters<typeof getBeaconParams>[0];
    GENESIS_FORK_VERSION: string;
  }[] = [
    {
      id: "Params defaults > returns mainnet",
      kwargs: {
        additionalParamsCli: {},
      },
      GENESIS_FORK_VERSION: GENESIS_FORK_VERSION_MAINNET,
    },
    {
      id: "Params from network > returns network",
      kwargs: {
        network: networkName,
        additionalParamsCli: {},
      },
      GENESIS_FORK_VERSION: GENESIS_FORK_VERSION_HOLESKY,
    },
    {
      id: "Params from network & file > returns file",
      kwargs: {
        network: networkName,
        paramsFile: paramsFilepath,
        additionalParamsCli: {},
      },
      GENESIS_FORK_VERSION: GENESIS_FORK_VERSION_FILE,
    },
    {
      id: "Params from network & file & CLI > returns CLI",
      kwargs: {
        network: networkName,
        paramsFile: paramsFilepath,
        additionalParamsCli: {GENESIS_FORK_VERSION: GENESIS_FORK_VERSION_CLI},
      },
      GENESIS_FORK_VERSION: GENESIS_FORK_VERSION_CLI,
    },
  ];

  beforeAll(() => {
    fs.writeFileSync(paramsFilepath, yaml.dump({GENESIS_FORK_VERSION: GENESIS_FORK_VERSION_FILE}));
  });

  afterAll(() => {
    if (fs.existsSync(paramsFilepath)) fs.unlinkSync(paramsFilepath);
  });

  it.each(testCases)("$id", ({kwargs, GENESIS_FORK_VERSION}) => {
    const params = getBeaconParams(kwargs);
    expect(toHexString(params.GENESIS_FORK_VERSION)).toBe(GENESIS_FORK_VERSION);
  });
});
