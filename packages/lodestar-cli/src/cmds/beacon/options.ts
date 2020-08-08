import {Options} from "yargs";
import {beaconNodeOptions, paramsOptions, IBeaconNodeOptions} from "../../options";
import {defaultBeaconPaths, IBeaconPaths} from "./paths";
import {IENRArgs, enrOptions} from "./enrOptions";
import { ICliCommandOptions } from "../../util";

export type IBeaconOptions =
  IBeaconNodeOptions &
  IBeaconPaths &
  IENRArgs &
  {
    genesisStateFile?: string;
    logFile?: string;
  };

const beaconPathsOptions: ICliCommandOptions<IBeaconPaths> = {
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
}

export const beaconOptions: {[k: string]: Options} = {
  ...beaconNodeOptions,
  ...paramsOptions,
  ...enrOptions,

  genesisStateFile: {
    description: "Genesis state in ssz-encoded format",
    type: "string",
    normalize: true,
  },

  // Beacon paths

  
};
