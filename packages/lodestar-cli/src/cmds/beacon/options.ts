import {Options} from "yargs";
import {IGlobalArgs} from "../../options";
import {paramsOptions, IParamsOptions, beaconNodeOptions, IBeaconNodeOptions} from "../../options";
import {defaultBeaconPaths, IBeaconPaths} from "./paths";
import {TestnetName} from "./testnets";

export type IBeaconOptions =
  IGlobalArgs &
  IBeaconNodeOptions &
  IParamsOptions &
  IBeaconPaths &
  {
    templateConfigFile?: string;
    genesisStateFile?: string;
    testnet?: TestnetName;
    logFile?: string;
  };

export const genesisStateFile = {
  description: "Genesis state in ssz-encoded format",
  type: "string",
  normalize: true,
} as Options;

export const beaconOptions: {[k: string]: Options} = {
  ...beaconNodeOptions,
  ...paramsOptions,
  genesisStateFile,

  templateConfigFile: {
    alias: ["templateConfigFile", "templateConfig"],
    description: "Template configuration used to initialize beacon node",
    type: "string",
    default: null,
  },

  testnet: {
    description: "Use a testnet configuration and genesis file",
    type: "string",
    choices: ["altona"] as TestnetName[],
  },

  // Beacon paths

  beaconDir: {
    description: "Beacon root dir",
    defaultDescription: defaultBeaconPaths.beaconDir,
    hidden: true,
    type: "string",
  },

  dbDir: {
    alias: ["db.dir", "db.name"],
    description: "Beacon DB dir",
    defaultDescription: defaultBeaconPaths.dbDir,
    hidden: true,
    normalize: true,
    type: "string",
  },

  configFile: {
    alias: ["config"],
    description: "Beacon node configuration file",
    defaultDescription: defaultBeaconPaths.configFile,
    type: "string",
    normalize: true,
  },

  peerIdFile: {
    hidden: true,
    description: "Peer ID file",
    defaultDescription: defaultBeaconPaths.peerIdFile,
    normalize: true,
    type: "string",
  },

  enrFile: {
    hidden: true,
    description: "ENR file",
    defaultDescription: defaultBeaconPaths.enrFile,
    normalize: true,
    type: "string",
  },

  logFile: {
    alias: ["log.file"],
    type: "string",
    normalize: true,
  }
};
