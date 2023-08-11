import {Options} from "yargs";
import {LogArgs, logOptions} from "../../options/logOptions.js";
import {CliCommandOptions} from "../../util/index.js";
import {NetworkArgs, options as networkOptions} from "../../options/beaconNodeOptions/network.js";
import {MetricsArgs, options as metricsOptions} from "../../options/beaconNodeOptions/metrics.js";

type BootnodeExtraArgs = {
  bootnodesFile?: string;
  persistNetworkIdentity?: boolean;
  "enr.ip"?: string;
  "enr.ip6"?: string;
  "enr.udp"?: number;
  "enr.udp6"?: number;
  nat?: boolean;
};

export const bootnodeExtraOptions: CliCommandOptions<BootnodeExtraArgs> = {
  bootnodesFile: {
    hidden: true,
    description: "Bootnodes file path",
    type: "string",
  },

  persistNetworkIdentity: {
    hidden: true,
    description: "Whether to reuse the same peer-id across restarts",
    default: true,
    type: "boolean",
  },

  "enr.ip": {
    description: "Override ENR IP entry",
    type: "string",
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

export type BootnodeArgs = BootnodeExtraArgs & LogArgs & NetworkArgs & MetricsArgs;

export const bootnodeOptions: {[k: string]: Options} = {
  ...bootnodeExtraOptions,
  ...logOptions,
  ...networkOptions,
  ...metricsOptions,
};
