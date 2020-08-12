import {Options} from "yargs";
import {beaconNodeOptions, paramsOptions, IBeaconNodeOptions} from "../../options";
import {defaultBeaconPaths, IBeaconPaths} from "./paths";
import {IENRArgs, enrOptions} from "./enrOptions";
import {ICliCommandOptions} from "../../util";

interface IBeaconExtraArgs {
  genesisStateFile?: string;
}

const beaconExtraOptions: ICliCommandOptions<IBeaconExtraArgs> = {
  genesisStateFile: {
    description: "Genesis state in ssz-encoded format",
    type: "string",
    normalize: true,
  }
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

  peerStoreDir: {
    hidden: true,
    description: "Peer store dir",
    defaultDescription: defaultBeaconPaths.peerStoreDir,
    normalize: true,
    type: "string",
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

export type IBeaconArgs =
  IBeaconNodeOptions &
  IBeaconPaths &
  IENRArgs &
  IBeaconExtraArgs;

export const beaconOptions: { [k: string]: Options } = {
  ...beaconPathsOptions,
  ...beaconExtraOptions,
  ...beaconNodeOptions,
  ...paramsOptions,
  ...enrOptions,
};
