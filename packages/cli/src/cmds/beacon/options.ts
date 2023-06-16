import {Options} from "yargs";
import {beaconNodeOptions, paramsOptions, BeaconNodeArgs} from "../../options/index.js";
import {LogArgs, logOptions} from "../../options/logOptions.js";
import {CliCommandOptions} from "../../util/index.js";
import {defaultBeaconPaths, BeaconPaths} from "./paths.js";

type BeaconExtraArgs = {
  forceGenesis?: boolean;
  genesisStateFile?: string;
  configFile?: string;
  bootnodesFile?: string;
  checkpointSyncUrl?: string;
  checkpointState?: string;
  wssCheckpoint?: string;
  forceCheckpointSync?: boolean;
  beaconDir?: string;
  dbDir?: string;
  persistInvalidSszObjectsDir?: string;
  persistInvalidSszObjectsRetentionHours?: number;
  peerStoreDir?: string;
  persistNetworkIdentity?: boolean;
  private?: boolean;
};

export const beaconExtraOptions: CliCommandOptions<BeaconExtraArgs> = {
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

  forceCheckpointSync: {
    description:
      "Force syncing from checkpoint state even if db state is within weak subjectivity period. This helps to avoid long sync times after node has been offline for a while.",
    type: "boolean",
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

  persistInvalidSszObjectsRetentionHours: {
    description: "Number of hours to keep invalid SSZ objects on local disk",
    hidden: true,
    type: "number",
  },

  peerStoreDir: {
    hidden: true,
    description: "Peer store directory",
    defaultDescription: defaultBeaconPaths.peerStoreDir,
    type: "string",
  },

  persistNetworkIdentity: {
    hidden: true,
    description: "Whether to reuse the same peer-id across restarts",
    type: "boolean",
  },

  private: {
    description: "Do not send implementation details over p2p identify protocol and in builder requests",
    type: "boolean",
  },
};

type ENRArgs = {
  "enr.ip"?: string;
  "enr.tcp"?: number;
  "enr.ip6"?: string;
  "enr.udp"?: number;
  "enr.tcp6"?: number;
  "enr.udp6"?: number;
  nat?: boolean;
};

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
  nat: {
    type: "boolean",
    description: "Allow configuration of non-local addresses",
    group: "enr",
  },
};

export type DebugArgs = {attachToGlobalThis: boolean};
export const debugOptions: CliCommandOptions<DebugArgs> = {
  attachToGlobalThis: {
    hidden: true,
    description: "Attach the beacon node to `globalThis`. Useful to inspect a running beacon node.",
    type: "boolean",
  },
};

export type BeaconArgs = BeaconExtraArgs & LogArgs & BeaconPaths & BeaconNodeArgs & ENRArgs & DebugArgs;

export const beaconOptions: {[k: string]: Options} = {
  ...beaconExtraOptions,
  ...logOptions,
  ...beaconNodeOptions,
  ...paramsOptions,
  ...enrOptions,
  ...debugOptions,
};
