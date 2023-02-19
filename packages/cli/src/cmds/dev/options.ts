import {Options} from "yargs";
import {CliCommandOptions} from "../../util/index.js";
import {beaconOptions, BeaconArgs} from "../beacon/options.js";
import {NetworkName} from "../../networks/index.js";
import {beaconNodeOptions, globalOptions} from "../../options/index.js";
import {IValidatorCliArgs, validatorOptions} from "../validator/options.js";

type IDevOwnArgs = {
  genesisEth1Hash?: string;
  genesisValidators: number;
  startValidators?: string;
  genesisTime?: number;
  reset?: boolean;
  dumpTestnetFiles?: string;
};

const devOwnOptions: CliCommandOptions<IDevOwnArgs> = {
  genesisEth1Hash: {
    description: "If present it will create genesis with this eth1 hash.",
    type: "string",
    group: "dev",
  },

  genesisValidators: {
    alias: ["c"],
    description: "If present it will create genesis with interop validators and start chain.",
    default: 8,
    type: "number",
    group: "dev",
  },

  startValidators: {
    description: "Start interop validators in inclusive range with notation '0..7'",
    type: "string",
    group: "dev",
  },

  genesisTime: {
    description: "genesis_time to initialize interop genesis state",
    defaultDescription: "now",
    type: "number",
    group: "dev",
  },

  reset: {
    description: "To delete chain and validator directories",
    alias: ["r"],
    type: "boolean",
    group: "dev",
  },

  dumpTestnetFiles: {
    description: "Dump testnet files and exit",
    type: "string",
    group: "dev",
  },
};

/**
 * Add custom defaults different than the ones in `beaconOptions`:
 * - In dev command we don't wanna connect to other peers,
 * - but we do wanna get out of syncing (min peers)
 * - and have api enabled by default (as it's used by validator)
 * Note: use beaconNodeOptions and globalOptions to make sure option key is correct
 */
const externalOptionsOverrides: Partial<Record<"network" | keyof typeof beaconNodeOptions, Options>> = {
  // Custom paths different than regular beacon, validator paths
  // network="dev" will store all data in separate dir than other networks
  network: {
    ...globalOptions.network,
    default: "dev" as NetworkName,
  },

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
  eth1: {
    ...beaconNodeOptions["eth1"],
    defaultDescription: undefined,
    default: false,
  },
  rest: {
    ...beaconNodeOptions["rest"],
    defaultDescription: undefined,
    default: true,
  },
};

export const devOptions = {
  ...beaconOptions,
  ...validatorOptions,
  ...externalOptionsOverrides,
  ...devOwnOptions,
};

export type IDevArgs = BeaconArgs & IValidatorCliArgs & IDevOwnArgs;
