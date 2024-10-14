import {CliOptionDefinition, CliCommandOptions} from "@lodestar/utils";
import {LogArgs, logOptions} from "../../options/logOptions.js";
import {MetricsArgs, options as metricsOptions} from "../../options/beaconNodeOptions/metrics.js";
import {defaultListenAddress, defaultP2pPort, defaultP2pPort6} from "../../options/beaconNodeOptions/network.js";

type BootnodeExtraArgs = {
  listenAddress?: string;
  port?: number;
  listenAddress6?: string;
  port6?: number;
  bootnodes?: string[];
  bootnodesFile?: string;
  persistNetworkIdentity?: boolean;
  "enr.ip"?: string;
  "enr.ip6"?: string;
  "enr.udp"?: number;
  "enr.udp6"?: number;
  nat?: boolean;
};

export const bootnodeExtraOptions: CliCommandOptions<BootnodeExtraArgs> = {
  listenAddress: {
    type: "string",
    description: "The IPv4 address to listen for discv5 connections",
    defaultDescription: defaultListenAddress,
    group: "network",
  },

  port: {
    alias: "discoveryPort",
    description: "The UDP port to listen on",
    type: "number",
    defaultDescription: String(defaultP2pPort),
    group: "network",
  },

  listenAddress6: {
    type: "string",
    description: "The IPv6 address to listen for discv5 connections",
    group: "network",
  },

  port6: {
    alias: "discoveryPort6",
    description: "The UDP port to listen on",
    type: "number",
    defaultDescription: String(defaultP2pPort6),
    group: "network",
  },

  bootnodes: {
    type: "array",
    description: "Additional bootnodes for discv5 discovery",
    defaultDescription: JSON.stringify([]),
    // Each bootnode entry could be comma separated, just deserialize it into a single array
    // as comma separated entries are generally most friendly in ansible kind of setups, i.e.
    // [ "en1", "en2,en3" ] => [ 'en1', 'en2', 'en3' ]
    coerce: (args: string[]) => args.flatMap((item) => item.split(",")),
    group: "network",
  },

  bootnodesFile: {
    description: "Additional bootnodes for discv5 discovery file path",
    type: "string",
    group: "network",
  },

  persistNetworkIdentity: {
    description: "Whether to reuse the same peer-id across restarts",
    default: true,
    type: "boolean",
    group: "network",
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
    description: "Allow ENR configuration of non-local addresses",
    group: "enr",
  },
};

export type BootnodeArgs = BootnodeExtraArgs & LogArgs & MetricsArgs;

export const bootnodeOptions: {[k: string]: CliOptionDefinition} = {
  ...bootnodeExtraOptions,
  ...logOptions,
  ...metricsOptions,
};
