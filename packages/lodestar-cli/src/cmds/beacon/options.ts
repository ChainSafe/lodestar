import {Options} from "yargs";
import {IGlobalArgs} from "../../options";
import {beaconNodeOptions, paramsOptions, IBeaconNodeOptions} from "../../options";
import {defaultBeaconPaths, IBeaconPaths} from "./paths";

export type IBeaconOptions =
  IGlobalArgs &
  IBeaconNodeOptions &
  IBeaconPaths &
  {
    genesisStateFile?: string;
    logFile?: string;
  };

export const beaconOptions: {[k: string]: Options} = {
  ...beaconNodeOptions,
  ...paramsOptions,

  genesisStateFile: {
    description: "Genesis state in ssz-encoded format",
    type: "string",
    normalize: true,
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
