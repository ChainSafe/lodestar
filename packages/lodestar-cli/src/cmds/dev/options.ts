import {ICliCommandOptions} from "../../util";
import {beaconOptions, IBeaconArgs} from "../beacon/options";
import {Options} from "yargs";

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

  // Add custom defaults different than the ones in `beaconOptions`:
  // - In dev command we don't wanna connect to other peers, 
  // - but we do wanna get out of syncing (min peers) 
  // - and have api enabled by default (as it's used by validator)
  "sync.minPeers": {
    type: "number",
    default: 0,
    group: "sync",
  } as Options,

  "network.maxPeers": {
    type: "number",
    default: 0,
    group: "network",
  } as Options,

  "eth1.enabled": {
    type: "boolean",
    default: false,
    group: "eth1",
  } as Options,

  "api.rest.enabled": {
    alias: ["api.enabled"],
    type: "boolean",
    default: true,
    group: "api",
  } as Options,
};

export type IDevArgs =
  IBeaconArgs &
  IDevOwnArgs;
