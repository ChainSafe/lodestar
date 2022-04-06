import {Options} from "yargs";
import {ICliCommandOptions} from "../../util/index.js";
import {beaconOptions, IBeaconArgs} from "../beacon/options.js";
import {beaconNodeOptions} from "../../options/index.js";
import {IValidatorCliArgs, validatorOptions} from "../validator/options.js";
import {KeymanagerArgs, keymanagerOptions} from "../../options/keymanagerOptions.js";

type IDevOwnArgs = {
  genesisEth1Hash?: string;
  genesisValidators?: number;
  startValidators?: string;
  genesisTime?: number;
  reset?: boolean;
  server: string;
} & KeymanagerArgs &
  Pick<IValidatorCliArgs, "importKeystoresPath" | "importKeystoresPassword">;

const devOwnOptions: ICliCommandOptions<IDevOwnArgs> = {
  ...keymanagerOptions,
  ...{
    importKeystoresPath: validatorOptions["importKeystoresPath"],
    importKeystoresPassword: validatorOptions["importKeystoresPassword"],
  },
  genesisEth1Hash: {
    description: "If present it will create genesis with this eth1 hash.",
    type: "string",
    group: "dev",
  },

  genesisValidators: {
    alias: ["c"],
    description: "If present it will create genesis with interop validators and start chain.",
    type: "number",
    group: "dev",
  },

  startValidators: {
    description: "Start interop validators in inclusive range with notation '0:7'",
    type: "string",
    group: "dev",
  },

  genesisTime: {
    description: "genesis_time to initialize interop genesis state",
    type: "number",
    group: "dev",
  },

  reset: {
    description: "To delete chain and validator directories",
    alias: ["r"],
    type: "boolean",
    group: "dev",
  },

  server: {
    description: "Address to connect to BeaconNode. Pass 'memory' for in memory communication",
    default: "http://127.0.0.1:9596",
    type: "string",
  },
};

/**
 * Add custom defaults different than the ones in `beaconOptions`:
 * - In dev command we don't wanna connect to other peers,
 * - but we do wanna get out of syncing (min peers)
 * - and have api enabled by default (as it's used by validator)
 * Note: use beaconNodeOptions and globalOptions to make sure option key is correct
 */
const externalOptionsOverrides: {[k: string]: Options} = {
  "sync.isSingleNode": {
    ...beaconNodeOptions["sync.isSingleNode"],
    defaultDescription: undefined,
    default: true,
  },
  "network.allowPublishToZeroPeers": {
    ...beaconNodeOptions["network.allowPublishToZeroPeers"],
    defaultDescription: undefined,
    default: true,
  },
  "network.maxPeers": {
    ...beaconNodeOptions["network.maxPeers"],
    defaultDescription: undefined,
    default: 1,
  },
  "network.targetPeers": {
    ...beaconNodeOptions["network.targetPeers"],
    defaultDescription: undefined,
    default: 1,
  },
  "eth1.enabled": {
    ...beaconNodeOptions["eth1.enabled"],
    defaultDescription: undefined,
    default: false,
  },
  "api.rest.enabled": {
    ...beaconNodeOptions["api.rest.enabled"],
    defaultDescription: undefined,
    default: true,
  },
};

export const devOptions = {
  ...beaconOptions,
  ...externalOptionsOverrides,
  ...devOwnOptions,
};

export type IDevArgs = IBeaconArgs & IDevOwnArgs;
