import {Options} from "yargs";
import {defaultLogLevel, LogLevel, LogLevels} from "@chainsafe/lodestar-utils";
import {beaconNodeOptions, paramsOptions, IBeaconNodeArgs, IENRArgs, enrOptions} from "../../options";
import {defaultBeaconPaths, IBeaconPaths} from "./paths";
import {ICliCommandOptions} from "../../util";

interface IBeaconExtraArgs {
  forceGenesis?: boolean;
  genesisStateFile?: string;
  weakSubjectivityStateFile?: string;
  logLevel: LogLevel;
}

const beaconExtraOptions: ICliCommandOptions<IBeaconExtraArgs> = {
  forceGenesis: {
    description: "Force beacon to create genesis without file",
    type: "boolean",
  },

  genesisStateFile: {
    description: "Path or URL to download a genesis state file in ssz-encoded format",
    type: "string",
  },

  weakSubjectivityStateFile: {
    description: "Path or URL to download a weak subjectivity state file in ssz-encoded format",
    type: "string",
  },

  logLevel: {
    choices: LogLevels,
    description: "Logging verbosity level",
    defaultDescription: defaultLogLevel,
    type: "string",
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
    description: "Beacon DB directory",
    defaultDescription: defaultBeaconPaths.dbDir,
    hidden: true,
    normalize: true,
    type: "string",
  },

  configFile: {
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
    type: "string",
    normalize: true,
  },
};

export type IBeaconArgs = IBeaconNodeArgs & IBeaconPaths & IENRArgs & IBeaconExtraArgs;

export const beaconOptions: {[k: string]: Options} = {
  ...beaconPathsOptions,
  ...beaconExtraOptions,
  ...beaconNodeOptions,
  ...paramsOptions,
  ...enrOptions,
};
