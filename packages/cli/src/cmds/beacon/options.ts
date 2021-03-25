import {Options} from "yargs";
import {defaultLogLevel, LogLevel, LogLevels} from "@chainsafe/lodestar-utils";
import {beaconNodeOptions, paramsOptions, IBeaconNodeArgs, IENRArgs, enrOptions} from "../../options";
import {defaultBeaconPaths, IBeaconPaths} from "./paths";
import {ICliCommandOptions} from "../../util";

interface IBeaconExtraArgs {
  forceGenesis?: boolean;
  genesisStateFile?: string;
  weakSubjectivityStateFile?: string;
  logLevel?: LogLevel;
  logLevelFile?: LogLevel;
}

export const beaconExtraOptions: ICliCommandOptions<IBeaconExtraArgs> = {
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

  logLevelFile: {
    choices: LogLevels,
    description: "Logging verbosity level for file transport",
    defaultDescription: defaultLogLevel,
    type: "string",
  },
};

export const beaconPathsOptions: ICliCommandOptions<IBeaconPaths> = {
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
    type: "string",
  },

  configFile: {
    description: "Beacon node configuration file path",
    defaultDescription: defaultBeaconPaths.configFile,
    type: "string",
  },

  peerStoreDir: {
    hidden: true,
    description: "Peer store directory",
    defaultDescription: defaultBeaconPaths.peerStoreDir,
    type: "string",
  },

  peerIdFile: {
    hidden: true,
    description: "Peer ID file path",
    defaultDescription: defaultBeaconPaths.peerIdFile,
    type: "string",
  },

  enrFile: {
    hidden: true,
    description: "ENR file path",
    defaultDescription: defaultBeaconPaths.enrFile,
    type: "string",
  },

  logFile: {
    description: "Path to output all logs to a persistent log file",
    type: "string",
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
