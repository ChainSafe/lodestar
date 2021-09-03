import {expect} from "chai";
import fs from "fs";
import yaml from "js-yaml";
import {toHexString} from "@chainsafe/ssz";
import {ACTIVE_PRESET, PresetName} from "@chainsafe/lodestar-params";
import {getTestdirPath} from "../../utils";
import {getBeaconParams} from "../../../src/config";

describe("config / beaconParams", () => {
  before("Must run with preset minimal", () => {
    expect(ACTIVE_PRESET).to.equal(PresetName.minimal);
  });

  const GENESIS_FORK_VERSION_MINIMAL = "0x00000001";
  const GENESIS_FORK_VERSION_FILE = "0x00009902";
  const GENESIS_FORK_VERSION_CLI = "0x00009903";
  const paramsFilepath = getTestdirPath("./test-config.yaml");

  const testCases: {
    id: string;
    kwargs: Parameters<typeof getBeaconParams>[0];
    // eslint-disable-next-line @typescript-eslint/naming-convention
    GENESIS_FORK_VERSION: string;
  }[] = [
    {
      id: "Params defaults > returns minimal",
      kwargs: {
        paramsFile: "./no/file",
        additionalParamsCli: {},
      },
      // eslint-disable-next-line @typescript-eslint/naming-convention
      GENESIS_FORK_VERSION: GENESIS_FORK_VERSION_MINIMAL,
    },
    {
      id: "Params from network & file > returns file",
      kwargs: {
        paramsFile: paramsFilepath,
        additionalParamsCli: {},
      },
      // eslint-disable-next-line @typescript-eslint/naming-convention
      GENESIS_FORK_VERSION: GENESIS_FORK_VERSION_FILE,
    },
    {
      id: "Params from network & file & CLI > returns CLI",
      kwargs: {
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
      expect(toHexString(params.GENESIS_FORK_VERSION)).to.equal(GENESIS_FORK_VERSION, "Wrong GENESIS_FORK_VERSION");
    });
  }
});
