import {expect} from "chai";
import fs from "fs";
import yaml from "js-yaml";
import {toHexString} from "@chainsafe/ssz";
import {getTestdirPath} from "../../utils";
import {getBeaconParams} from "../../../src/config";

describe("config / beaconParams", () => {
  const GENESIS_FORK_VERSION_MAINNET = "0x00000000";
  const GENESIS_FORK_VERSION_PYRMONT = "0x00002009";
  const GENESIS_FORK_VERSION_FILE = "0x00009902";
  const GENESIS_FORK_VERSION_CLI = "0x00009903";
  const presetName = "mainnet";
  const networkName = "pyrmont";
  const paramsFilepath = getTestdirPath("./test-config.yaml");

  const testCases: {
    id: string;
    kwargs: Parameters<typeof getBeaconParams>[0];
    // eslint-disable-next-line @typescript-eslint/naming-convention
    GENESIS_FORK_VERSION: string;
  }[] = [
    {
      id: "Params from preset > returns preset",
      kwargs: {
        preset: presetName,
        paramsFile: "./no/file",
        additionalParamsCli: {},
      },
      // eslint-disable-next-line @typescript-eslint/naming-convention
      GENESIS_FORK_VERSION: GENESIS_FORK_VERSION_MAINNET,
    },
    {
      id: "Params from preset & network > returns network",
      kwargs: {
        preset: presetName,
        network: networkName,
        paramsFile: "./no/file",
        additionalParamsCli: {},
      },
      // eslint-disable-next-line @typescript-eslint/naming-convention
      GENESIS_FORK_VERSION: GENESIS_FORK_VERSION_PYRMONT,
    },
    {
      id: "Params from preset & network & file > returns file",
      kwargs: {
        preset: presetName,
        network: networkName,
        paramsFile: paramsFilepath,
        additionalParamsCli: {},
      },
      // eslint-disable-next-line @typescript-eslint/naming-convention
      GENESIS_FORK_VERSION: GENESIS_FORK_VERSION_FILE,
    },
    {
      id: "Params from preset & network & file & CLI > returns CLI",
      kwargs: {
        preset: presetName,
        network: networkName,
        paramsFile: paramsFilepath,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        additionalParamsCli: {GENESIS_FORK_VERSION: GENESIS_FORK_VERSION_CLI},
      },
      // eslint-disable-next-line @typescript-eslint/naming-convention
      GENESIS_FORK_VERSION: GENESIS_FORK_VERSION_CLI,
    },
  ];

  before("Write config file", () => {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    fs.writeFileSync(paramsFilepath, yaml.dump({GENESIS_FORK_VERSION: GENESIS_FORK_VERSION_FILE}));
  });

  after("Remove config file", () => {
    if (fs.existsSync(paramsFilepath)) fs.unlinkSync(paramsFilepath);
  });

  for (const {id, kwargs, GENESIS_FORK_VERSION} of testCases) {
    it(id, () => {
      const params = getBeaconParams(kwargs);
      expect(toHexString(params.GENESIS_FORK_VERSION)).to.equal(GENESIS_FORK_VERSION);
    });
  }
});
