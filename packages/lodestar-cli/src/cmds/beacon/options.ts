import {Options} from "yargs";
import {beaconNodeOptions, paramsOptions, IBeaconNodeOptions} from "../../options";
import {defaultBeaconPaths, IBeaconPaths} from "./paths";
import {IENRArgs, enrOptions} from "./enrOptions";
import {ICliCommandOptions} from "../../util";

interface IBeaconExtraArgs {
  genesisStateFile?: string;
  forceGenesis?: boolean;
  weakSubjectivityStateFile?: string;
}

const beaconExtraOptions: ICliCommandOptions<IBeaconExtraArgs> = {
  genesisStateFile: {
    description: "Genesis state file path in ssz-encoded format",
    type: "string",
    normalize: true,
  },
  forceGenesis: {
    description: "Force beacon to create genesis without file",
    type: "boolean",
  },
  weakSubjectivityStateFile: {
    description: "Weak subjectivity state file path in ssz-encoded format",
    type: "string",
    normalize: true,
  },
};

const beaconPathsOptions: ICliCommandOptions<IBeaconPaths> = {
  beaconDir: {
    description: "Beacon root directory",
    defaultDescription: defaultBeaconPaths.beaconDir,
    hidden: true,
    type: "string",
  },

  dbDir: {
    alias: ["db.dir", "db.name"],
    description: "Beacon DB directory",
    defaultDescription: defaultBeaconPaths.dbDir,
    hidden: true,
    normalize: true,
    type: "string",
  },

  configFile: {
    alias: ["config"],
    description: "Beacon node configuration file path",
    defaultDescription: defaultBeaconPaths.configFile,
    type: "string",
    normalize: true,
  },

  peerStoreDir: {
    hidden: true,
    description: "Peer store directory",
    defaultDescription: defaultBeaconPaths.peerStoreDir,
    normalize: true,
    type: "string",
  },

  peerIdFile: {
    hidden: true,
    description: "Peer ID file path",
    defaultDescription: defaultBeaconPaths.peerIdFile,
    normalize: true,
    type: "string",
  },

  enrFile: {
    hidden: true,
    description: "ENR file path",
    defaultDescription: defaultBeaconPaths.enrFile,
    normalize: true,
    type: "string",
  },

  logFile: {
    description: "Path to output all logs to a persistent log file",
    alias: ["log.file"],
    type: "string",
    normalize: true,
  },
};

export type IBeaconArgs = IBeaconNodeOptions & IBeaconPaths & IENRArgs & IBeaconExtraArgs;

export const beaconOptions: {[k: string]: Options} = {
  ...beaconPathsOptions,
  ...beaconExtraOptions,
  ...beaconNodeOptions,
  ...paramsOptions,
  ...enrOptions,
};
