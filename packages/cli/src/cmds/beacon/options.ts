import {Options} from "yargs";
import {defaultLogLevel, LogLevels} from "@chainsafe/lodestar-utils";
import {
  beaconNodeOptions,
  paramsOptions,
  IBeaconNodeArgs,
  IENRArgs,
  enrOptions,
  IWSSArgs,
  wssOptions,
} from "../../options";
import {defaultBeaconPaths, IBeaconPaths} from "./paths";
import {ICliCommandOptions, ILogArgs} from "../../util";

interface IBeaconExtraArgs {
  port?: number;
  discoveryPort?: number;
  forceGenesis?: boolean;
  genesisStateFile?: string;
}

export const beaconExtraOptions: ICliCommandOptions<IBeaconExtraArgs> = {
  port: {
    description: "The TCP/UDP port to listen on. The UDP port can be modified by the --discovery-port flag.",
    type: "number",
    // TODO: Derive from BeaconNode defaults
    defaultDescription: "9000",
  },

  discoveryPort: {
    description: "The UDP port that discovery will listen on. Defaults to `port`",
    type: "number",
    defaultDescription: "`port`",
  },

  forceGenesis: {
    description: "Force beacon to create genesis without file",
    type: "boolean",
  },

  genesisStateFile: {
    description: "Path or URL to download a genesis state file in ssz-encoded format",
    type: "string",
  },
};

export const logOptions: ICliCommandOptions<ILogArgs> = {
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

  logRotate: {
    description: "Daily rotate log files",
    type: "boolean",
  },

  logMaxFiles: {
    description: "Number of log files to maintain while rotating logs(if provided with logRotate)",
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
    description: "Directory to persist invalid ssz objects",
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

export type IBeaconArgs = IBeaconExtraArgs & ILogArgs & IBeaconPaths & IBeaconNodeArgs & IENRArgs & IWSSArgs;

export const beaconOptions: {[k: string]: Options} = {
  ...beaconExtraOptions,
  ...logOptions,
  ...beaconPathsOptions,
  ...beaconNodeOptions,
  ...paramsOptions,
  ...enrOptions,
  ...wssOptions,
};
