import {Options} from "yargs";
import {defaultLogLevel, LogLevels} from "@chainsafe/lodestar-utils";
import {beaconNodeOptions, paramsOptions, IBeaconNodeArgs, IENRArgs, enrOptions} from "../../options";
import {defaultBeaconPaths, IBeaconPaths} from "./paths";
import {ICliCommandOptions, ILogArgs} from "../../util";

interface IBeaconExtraArgs {
  forceGenesis?: boolean;
  genesisStateFile?: string;
  weakSubjectivityStateFile?: string;
  weakSubjectivityCheckpoint?: string;
  weakSubjectivityServerUrl?: string;
  weakSubjectivitySyncLatest?: string;
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

  weakSubjectivitySyncLatest: {
    description:
      "Enable fetching of a weak subjectivity state via --weakSubjectivityServerUrl.  If an argument is provided to --weakSubjectivityCheckpoint, fetch the state at that checkpoint.  Else, fetch the latest finalized state.",
    type: "boolean",
    default: false,
  },

  weakSubjectivityCheckpoint: {
    description:
      "Tell the beacon node to fetch a weak subjectivity state at the specified checkpoint. The string arg must be in the form <blockRoot>:<epoch>. For example, 0x1234:100 would ask for the weak subjectivity state at checkpoint of epoch 100 with block root 0x1234.",
    type: "string",
  },

  weakSubjectivityServerUrl: {
    description:
      "Pass in a custom server from which to fetch weak subjectivity states (if you don't want to use the built-in Lodestar servers).",
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
    description: "Daily rotate log file to keep last 5 (including current)",
    type: "boolean",
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

export type IBeaconArgs = IBeaconExtraArgs & ILogArgs & IBeaconPaths & IBeaconNodeArgs & IENRArgs;

export const beaconOptions: {[k: string]: Options} = {
  ...beaconExtraOptions,
  ...logOptions,
  ...beaconPathsOptions,
  ...beaconNodeOptions,
  ...paramsOptions,
  ...enrOptions,
};
