import {Options} from "yargs";
import {logFormats, LogLevel, LogLevels} from "@lodestar/utils";
import {beaconNodeOptions, paramsOptions, IBeaconNodeArgs} from "../../options/index.js";
import {defaultLogMaxFiles, ICliCommandOptions, ILogArgs} from "../../util/index.js";
import {defaultBeaconPaths, IBeaconPaths} from "./paths.js";

interface IBeaconExtraArgs {
  forceGenesis?: boolean;
  genesisStateFile?: string;
  configFile?: string;
  bootnodesFile?: string;
  checkpointSyncUrl?: string;
  checkpointState?: string;
  wssCheckpoint?: string;
}

export const beaconExtraOptions: ICliCommandOptions<IBeaconExtraArgs> = {
  forceGenesis: {
    description: "Force beacon to create genesis without file",
    type: "boolean",
    hidden: true,
  },

  genesisStateFile: {
    hidden: true,
    description: "Path or URL to download a genesis state file in ssz-encoded format",
    type: "string",
  },

  configFile: {
    hidden: true,
    description: "[DEPRECATED] Beacon node configuration file path",
    type: "string",
  },

  bootnodesFile: {
    hidden: true,
    description: "Bootnodes file path",
    type: "string",
  },

  checkpointSyncUrl: {
    description:
      "Server url hosting Beacon Node APIs to fetch weak subjectivity state. Fetch latest finalized by default, else set --wssCheckpoint",
    type: "string",
    group: "weak subjectivity",
  },

  checkpointState: {
    description: "Set a checkpoint state to start syncing from",
    type: "string",
    group: "weak subjectivity",
  },

  wssCheckpoint: {
    description:
      "Start beacon node off a state at the provided weak subjectivity checkpoint, to be supplied in <blockRoot>:<epoch> format. For example, 0x1234:100 will sync and start off from the weakSubjectivity state at checkpoint of epoch 100 with block root 0x1234.",
    type: "string",
    group: "weak subjectivity",
  },
};

export const logOptions: ICliCommandOptions<ILogArgs> = {
  logLevel: {
    choices: LogLevels,
    description: "Logging verbosity level for emittings logs to terminal",
    defaultDescription: LogLevel.info,
    type: "string",
  },

  logFileLevel: {
    choices: LogLevels,
    description: "Logging verbosity level for emittings logs to file",
    defaultDescription: LogLevel.debug,
    type: "string",
  },

  logFileDailyRotate: {
    description: `Daily rotate log files, set to an integer to limit the file count, else defaults to ${defaultLogMaxFiles}`,
    type: "number",
  },

  logFormatGenesisTime: {
    hidden: true,
    description:
      "Use epoch slot timestamp format, instead or regular timestamp. Must provide genesisTime to compute relative time",
    type: "number",
  },

  logPrefix: {
    hidden: true,
    description: "Logger prefix module field with a string ID",
    type: "string",
  },

  logFormat: {
    hidden: true,
    description: "Log format used when emitting logs to the terminal and / or file",
    choices: logFormats,
    type: "string",
  },

  logLevelModule: {
    hidden: true,
    description: "Set log level for a specific module by name: 'chain=debug' or 'network=debug,chain=debug'",
    type: "array",
    string: true,
    coerce: (args: string[]) => args.map((item) => item.split(",")).flat(1),
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

  peerStoreDir: {
    hidden: true,
    description: "Peer store directory",
    defaultDescription: defaultBeaconPaths.peerStoreDir,
    type: "string",
  },

  logFile: {
    description: "Path to output all logs to a persistent log file",
    type: "string",
  },
};

interface IENRArgs {
  "enr.ip"?: string;
  "enr.tcp"?: number;
  "enr.ip6"?: string;
  "enr.udp"?: number;
  "enr.tcp6"?: number;
  "enr.udp6"?: number;
}

const enrOptions: Record<string, Options> = {
  "enr.ip": {
    description: "Override ENR IP entry",
    type: "string",
    group: "enr",
  },
  "enr.tcp": {
    description: "Override ENR TCP entry",
    type: "number",
    group: "enr",
  },
  "enr.udp": {
    description: "Override ENR UDP entry",
    type: "number",
    group: "enr",
  },
  "enr.ip6": {
    description: "Override ENR IPv6 entry",
    type: "string",
    group: "enr",
  },
  "enr.tcp6": {
    description: "Override ENR (IPv6-specific) TCP entry",
    type: "number",
    group: "enr",
  },
  "enr.udp6": {
    description: "Override ENR (IPv6-specific) UDP entry",
    type: "number",
    group: "enr",
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

export type IBeaconArgs = IBeaconExtraArgs & ILogArgs & IBeaconPaths & IBeaconNodeArgs & IENRArgs & DebugArgs;

export const beaconOptions: {[k: string]: Options} = {
  ...beaconExtraOptions,
  ...logOptions,
  ...beaconPathsOptions,
  ...beaconNodeOptions,
  ...paramsOptions,
  ...enrOptions,
  ...debugOptions,
};
