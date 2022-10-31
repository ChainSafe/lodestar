import {Options} from "yargs";
import {beaconNodeOptions, paramsOptions, IBeaconNodeArgs} from "../../options/index.js";
import {logOptions} from "../../options/logOptions.js";
import {ICliCommandOptions, ILogArgs} from "../../util/index.js";
import {defaultBeaconPaths, IBeaconPaths} from "./paths.js";

interface IBeaconExtraArgs {
  forceGenesis?: boolean;
  genesisStateFile?: string;
  configFile?: string;
  bootnodesFile?: string;
  checkpointSyncUrl?: string;
  checkpointState?: string;
  wssCheckpoint?: string;
  beaconDir?: string;
  dbDir?: string;
  persistInvalidSszObjectsDir?: string;
  peerStoreDir?: string;
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
  ...beaconNodeOptions,
  ...paramsOptions,
  ...enrOptions,
  ...debugOptions,
};
