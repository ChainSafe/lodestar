import {Options} from "yargs";
import {defaultLogLevel, LogLevels} from "@lodestar/utils";
import {
  beaconNodeOptions,
  paramsOptions,
  IBeaconNodeArgs,
  IENRArgs,
  enrOptions,
  IWSSArgs,
  wssOptions,
} from "../../options/index.js";
import {defaultLogMaxFiles, ICliCommandOptions, ILogArgs} from "../../util/index.js";
import {defaultBeaconPaths, IBeaconPaths} from "./paths.js";

interface IBeaconExtraArgs {
  forceGenesis?: boolean;
  genesisStateFile?: string;
}

export const beaconExtraOptions: ICliCommandOptions<IBeaconExtraArgs> = {
  forceGenesis: {
    description: "Force beacon to create genesis without file",
    type: "boolean",
    hidden: true,
  },

  genesisStateFile: {
    description: "Path or URL to download a genesis state file in ssz-encoded format",
    type: "string",
    hidden: true,
  },
};

export const logOptions: ICliCommandOptions<ILogArgs> = {
  logLevel: {
    choices: LogLevels,
    description: "Logging verbosity level",
    defaultDescription: defaultLogLevel,
    type: "string",
  },

  logFileLevel: {
    choices: LogLevels,
    description: "Logging verbosity level for file transport",
    defaultDescription: defaultLogLevel,
    type: "string",
  },

  logFormatGenesisTime: {
    hidden: true,
    description: "Logger format - Use EpochSlot TimestampFormat",
    type: "number",
  },

  logFormatId: {
    hidden: true,
    description: "Logger format - Prefix module field with a string ID",
    type: "string",
  },

  logFileDailyRotate: {
    description: `Daily rotate log files, set to an integer to limit the file count, else defaults to ${defaultLogMaxFiles}`,
    type: "number",
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

  persistInvalidSszObjectsDir: {
    description: "Enable and specify a directory to persist invalid ssz objects",
    defaultDescription: defaultBeaconPaths.persistInvalidSszObjectsDir,
    hidden: true,
    type: "string",
  },

  configFile: {
    description: "Beacon node configuration file path",
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

  bootnodesFile: {
    hidden: true,
    description: "Bootnodes file path",
    type: "string",
  },
};

export type DebugArgs = {attachToGlobalThis: boolean};
export const debugOptions: ICliCommandOptions<DebugArgs> = {
  attachToGlobalThis: {
    hidden: true,
    description: "Attach the beacon node to `globalThis`. Useful to inspect a running beacon node.",
    type: "boolean",
  },
};

export type IBeaconArgs = IBeaconExtraArgs &
  ILogArgs &
  IBeaconPaths &
  IBeaconNodeArgs &
  IENRArgs &
  IWSSArgs &
  DebugArgs;

export const beaconOptions: {[k: string]: Options} = {
  ...beaconExtraOptions,
  ...logOptions,
  ...beaconPathsOptions,
  ...beaconNodeOptions,
  ...paramsOptions,
  ...enrOptions,
  ...wssOptions,
  ...debugOptions,
};
