import {expect} from "chai";
import fs from "node:fs";
import yaml from "js-yaml";
import {toHexString} from "@chainsafe/ssz";
import {getTestdirPath} from "../../utils";
import {getBeaconParams} from "../../../src/config";

describe("config / beaconParams", () => {
  const GENESIS_FORK_VERSION_MAINNET = "0x00000000";
  const GENESIS_FORK_VERSION_PRATER = "0x00001020";
  const GENESIS_FORK_VERSION_FILE = "0x00009902";
  const GENESIS_FORK_VERSION_CLI = "0x00009903";
  const networkName = "prater";
  const paramsFilepath = getTestdirPath("./test-config.yaml");

  const testCases: {
    id: string;
    kwargs: Parameters<typeof getBeaconParams>[0];
    // eslint-disable-next-line @typescript-eslint/naming-convention
    GENESIS_FORK_VERSION: string;
  }[] = [
    {
      id: "Params defaults > returns mainnet",
      kwargs: {
        additionalParamsCli: {},
      },
      // eslint-disable-next-line @typescript-eslint/naming-convention
      GENESIS_FORK_VERSION: GENESIS_FORK_VERSION_MAINNET,
    },
    {
      id: "Params from network > returns network",
      kwargs: {
        network: networkName,
        additionalParamsCli: {},
      },
      // eslint-disable-next-line @typescript-eslint/naming-convention
      GENESIS_FORK_VERSION: GENESIS_FORK_VERSION_PRATER,
    },
    {
      id: "Params from network & file > returns file",
      kwargs: {
        network: networkName,
        paramsFile: paramsFilepath,
        additionalParamsCli: {},
      },
      // eslint-disable-next-line @typescript-eslint/naming-convention
      GENESIS_FORK_VERSION: GENESIS_FORK_VERSION_FILE,
    },
    {
      id: "Params from network & file & CLI > returns CLI",
      kwargs: {
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
