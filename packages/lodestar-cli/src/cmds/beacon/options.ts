import {Options} from "yargs";
import {IGlobalArgs} from "../../options";
import {paramsOptions, IParamsOptions, beaconNodeOptions, IBeaconNodeOptions} from "../../options";
import {TestnetName} from "../../testnets";
import {defaultBeaconPaths, IBeaconPaths} from "./paths";

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

export const beaconOptions: {[k: string]: Options} = {
  ...beaconNodeOptions,
  ...paramsOptions,

  templateConfigFile: {
    alias: ["templateConfigFile", "templateConfig"],
    description: "Template configuration used to initialize beacon node",
    type: "string",
    default: null,
  },

  genesisStateFile: {
    description: "Genesis state in ssz-encoded format",
    type: "string",
    normalize: true,
  },

  testnet: {
    description: "Use a testnet configuration and genesis file",
    type: "string",
    choices: ["altona", "medalla"] as TestnetName[],
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
