import {ICliCommandOptions} from "../../util";
import {beaconOptions, IBeaconArgs} from "../beacon/options";
import {Options} from "yargs";
import defaultOptions from "@chainsafe/lodestar/lib/node/options";

interface IDevOwnArgs {
  genesisValidators?: number;
  startValidators?: string;
  reset?: boolean;
  server: string;
}

const devOwnOptions: ICliCommandOptions<IDevOwnArgs> = {
  genesisValidators: {
    description: "If present it will create genesis with interop validators and start chain.",
    type: "number",
    group: "dev",
  },

  startValidators: {
    description: "Start interop validators in given range",
    default: "0:8",
    type: "string",
    group: "dev",
  },

  reset: {
    description: "To delete chain and validator directories",
    type: "boolean",
    group: "dev",
  },

  server: {
    description: "Address to connect to BeaconNode. Pass 'memory' for in memory communication",
    default: "http://127.0.0.1:9596",
    type: "string",
  }
};

export const devOptions = {
  ...beaconOptions,
  ...devOwnOptions,

  "sync.minPeers": {
    type: "number",
    default: 0,
    group: "sync",
  } as Options,

  "network.maxPeers": {
    type: "number",
    defaultDescription: String(defaultOptions.network.maxPeers),
    default: 0,
    group: "network",
  } as Options,

  "eth1.enabled": {
    type: "boolean",
    default: false,
    group: "eth1",
  } as Options,
};

export type IDevArgs =
  IBeaconArgs &
  IDevOwnArgs;
