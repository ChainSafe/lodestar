import {multiaddr} from "@multiformats/multiaddr";
import {ENR} from "@chainsafe/enr";
import {defaultOptions, IBeaconNodeOptions} from "@lodestar/beacon-node";
import {CliCommandOptions} from "@lodestar/utils";
import {YargsError} from "../../util/index.js";

export const defaultListenAddress = "0.0.0.0";
export const defaultP2pPort = 9000;
export const defaultP2pPort6 = 9090;

export type NetworkArgs = {
  discv5?: boolean;
  listenAddress?: string;
  port?: number;
  discoveryPort?: number;
  listenAddress6?: string;
  port6?: number;
  discoveryPort6?: number;
  bootnodes?: string[];
  targetPeers?: number;
  subscribeAllSubnets?: boolean;
  slotsToSubscribeBeforeAggregatorDuty?: number;
  disablePeerScoring?: boolean;
  mdns?: boolean;
  "network.maxPeers"?: number;
  "network.connectToDiscv5Bootnodes"?: boolean;
  "network.discv5FirstQueryDelayMs"?: number;
  "network.dontSendGossipAttestationsToForkchoice"?: boolean;
  "network.allowPublishToZeroPeers"?: boolean;
  "network.gossipsubD"?: number;
  "network.gossipsubDLow"?: number;
  "network.gossipsubDHigh"?: number;
  "network.gossipsubAwaitHandler"?: boolean;
  "network.disableFloodPublish"?: boolean;
  "network.rateLimitMultiplier"?: number;
  "network.maxGossipTopicConcurrency"?: number;
  "network.useWorker"?: boolean;
  "network.maxYoungGenerationSizeMb"?: number;

  /** @deprecated This option is deprecated and should be removed in next major release. */
  "network.requestCountPeerLimit"?: number;
  /** @deprecated This option is deprecated and should be removed in next major release. */
  "network.blockCountTotalLimit"?: number;
  /** @deprecated This option is deprecated and should be removed in next major release. */
  "network.blockCountPeerLimit"?: number;
  /** @deprecated This option is deprecated and should be removed in next major release. */
  "network.rateTrackerTimeoutMs"?: number;
};

function validateMultiaddrArg<T extends Record<string, string | undefined>>(args: T, key: keyof T): void {
  if (args[key]) {
    try {
      multiaddr(args[key]);
    } catch (e) {
      throw new YargsError(`Invalid ${key as string}: ${(e as Error).message}`);
    }
  }
}

export function parseListenArgs(args: NetworkArgs) {
  // If listenAddress is explicitly set, use it
  // If listenAddress6 is not set, use defaultListenAddress
  const listenAddress = args.listenAddress ?? (args.listenAddress6 ? undefined : defaultListenAddress);
  const port = listenAddress ? (args.port ?? defaultP2pPort) : undefined;
  const discoveryPort = listenAddress ? (args.discoveryPort ?? args.port ?? defaultP2pPort) : undefined;

  // Only use listenAddress6 if it is explicitly set
  const listenAddress6 = args.listenAddress6;
  const port6 = listenAddress6 ? (args.port6 ?? defaultP2pPort6) : undefined;
  const discoveryPort6 = listenAddress6 ? (args.discoveryPort6 ?? args.port6 ?? defaultP2pPort6) : undefined;

  return {listenAddress, port, discoveryPort, listenAddress6, port6, discoveryPort6};
}

export function parseArgs(args: NetworkArgs): IBeaconNodeOptions["network"] {
  const {listenAddress, port, discoveryPort, listenAddress6, port6, discoveryPort6} = parseListenArgs(args);
  // validate ip, ip6, ports
  const muArgs = {
    listenAddress: listenAddress ? `/ip4/${listenAddress}` : undefined,
    port: listenAddress ? `/tcp/${port}` : undefined,
    discoveryPort: listenAddress ? `/udp/${discoveryPort}` : undefined,
    listenAddress6: listenAddress6 ? `/ip6/${listenAddress6}` : undefined,
    port6: listenAddress6 ? `/tcp/${port6}` : undefined,
    discoveryPort6: listenAddress6 ? `/udp/${discoveryPort6}` : undefined,
  };

  for (const key of [
    "listenAddress",
    "port",
    "discoveryPort",
    "listenAddress6",
    "port6",
    "discoveryPort6",
  ] as (keyof typeof muArgs)[]) {
    validateMultiaddrArg(muArgs, key);
  }

  const bindMu = listenAddress ? `${muArgs.listenAddress}${muArgs.discoveryPort}` : undefined;
  const localMu = listenAddress ? `${muArgs.listenAddress}${muArgs.port}` : undefined;
  const bindMu6 = listenAddress6 ? `${muArgs.listenAddress6}${muArgs.discoveryPort6}` : undefined;
  const localMu6 = listenAddress6 ? `${muArgs.listenAddress6}${muArgs.port6}` : undefined;

  const targetPeers = args["targetPeers"];
  const maxPeers = args["network.maxPeers"] ?? (targetPeers !== undefined ? Math.floor(targetPeers * 1.1) : undefined);
  if (targetPeers != null && maxPeers != null && targetPeers > maxPeers) {
    throw new YargsError("network.maxPeers must be greater than or equal to targetPeers");
  }
  // Set discv5 opts to null to disable only if explicitly disabled
  const enableDiscv5 = args["discv5"] ?? true;

  // TODO: Okay to set to empty array?
  const bootEnrs = args["bootnodes"] ?? [];
  // throw if user-provided enrs are invalid
  for (const enrStr of bootEnrs) {
    try {
      ENR.decodeTxt(enrStr);
    } catch (_e) {
      throw new YargsError(`Provided ENR in bootnodes is invalid:\n    ${enrStr}`);
    }
  }

  return {
    discv5: enableDiscv5
      ? {
          config: {},
          bindAddrs: {
            ip4: bindMu as string,
            ip6: bindMu6,
          },
          bootEnrs,
          // biome-ignore lint/suspicious/noExplicitAny: <explanation>
          enr: undefined as any,
        }
      : null,
    maxPeers: maxPeers ?? defaultOptions.network.maxPeers,
    targetPeers: targetPeers ?? defaultOptions.network.targetPeers,
    localMultiaddrs: [localMu, localMu6].filter(Boolean) as string[],
    subscribeAllSubnets: args["subscribeAllSubnets"],
    slotsToSubscribeBeforeAggregatorDuty:
      args["slotsToSubscribeBeforeAggregatorDuty"] ?? defaultOptions.network.slotsToSubscribeBeforeAggregatorDuty,
    disablePeerScoring: args["disablePeerScoring"],
    connectToDiscv5Bootnodes: args["network.connectToDiscv5Bootnodes"],
    discv5FirstQueryDelayMs: args["network.discv5FirstQueryDelayMs"],
    dontSendGossipAttestationsToForkchoice: args["network.dontSendGossipAttestationsToForkchoice"],
    allowPublishToZeroPeers: args["network.allowPublishToZeroPeers"],
    gossipsubD: args["network.gossipsubD"],
    gossipsubDLow: args["network.gossipsubDLow"],
    gossipsubDHigh: args["network.gossipsubDHigh"],
    gossipsubAwaitHandler: args["network.gossipsubAwaitHandler"],
    disableFloodPublish: args["network.disableFloodPublish"],
    mdns: args["mdns"],
    rateLimitMultiplier: args["network.rateLimitMultiplier"],
    maxGossipTopicConcurrency: args["network.maxGossipTopicConcurrency"],
    useWorker: args["network.useWorker"],
    maxYoungGenerationSizeMb: args["network.maxYoungGenerationSizeMb"],
  };
}

export const options: CliCommandOptions<NetworkArgs> = {
  discv5: {
    type: "boolean",
    // TODO: Add `network.discv5.enabled` to the `IDiscv5DiscoveryInputOptions` type
    description: "Enable discv5",
    defaultDescription: String(true),
    group: "network",
  },

  listenAddress: {
    type: "string",
    description: "The IPv4 address to listen for p2p UDP and TCP connections",
    defaultDescription: defaultListenAddress,
    group: "network",
  },

  port: {
    description: "The TCP/UDP port to listen on. The UDP port can be modified by the --discoveryPort flag.",
    type: "number",
    // TODO: Derive from BeaconNode defaults
    defaultDescription: String(defaultP2pPort),
    group: "network",
  },

  discoveryPort: {
    description: "The UDP port that discovery will listen on. Defaults to `port`",
    type: "number",
    defaultDescription: "`port`",
    group: "network",
  },

  listenAddress6: {
    type: "string",
    description: "The IPv6 address to listen for p2p UDP and TCP connections",
    group: "network",
  },

  port6: {
    description: "The TCP/UDP port to listen on. The UDP port can be modified by the --discoveryPort6 flag.",
    type: "number",
    // TODO: Derive from BeaconNode defaults
    defaultDescription: String(defaultP2pPort6),
    group: "network",
  },

  discoveryPort6: {
    description: "The UDP port that discovery will listen on. Defaults to `port6`",
    type: "number",
    defaultDescription: "`port6`",
    group: "network",
  },

  bootnodes: {
    type: "array",
    description: "Bootnodes for discv5 discovery",
    defaultDescription: JSON.stringify((defaultOptions.network.discv5 || {}).bootEnrs || []),
    group: "network",
    // Each bootnode entry could be comma separated, just deserialize it into a single array
    // as comma separated entries are generally most friendly in ansible kind of setups, i.e.
    // [ "en1", "en2,en3" ] => [ 'en1', 'en2', 'en3' ]
    coerce: (args: string[]) => args.flatMap((item) => item.split(",")),
  },

  targetPeers: {
    type: "number",
    description: "The target connected peers. Above this number peers will be disconnected",
    defaultDescription: String(defaultOptions.network.targetPeers),
    group: "network",
  },

  subscribeAllSubnets: {
    type: "boolean",
    description: "Subscribe to all subnets regardless of validator count",
    defaultDescription: String(defaultOptions.network.subscribeAllSubnets === true),
    group: "network",
  },

  slotsToSubscribeBeforeAggregatorDuty: {
    hidden: true,
    type: "number",
    description: "Number of slots before an aggregator duty to subscribe to subnets",
    defaultDescription: String(defaultOptions.network.slotsToSubscribeBeforeAggregatorDuty),
    group: "network",
  },

  disablePeerScoring: {
    type: "boolean",
    description: "Disable peer scoring, used for testing on devnets",
    defaultDescription: String(defaultOptions.network.disablePeerScoring === true),
    group: "network",
  },

  mdns: {
    type: "boolean",
    description: "Enable mdns local peer discovery",
    defaultDescription: String(defaultOptions.network.mdns === true),
    group: "network",
  },

  "network.maxPeers": {
    hidden: true,
    type: "number",
    description: "The maximum number of connections allowed",
    defaultDescription: String(defaultOptions.network.maxPeers),
    group: "network",
  },

  "network.connectToDiscv5Bootnodes": {
    type: "boolean",
    description: "Attempt direct libp2p peer connection to discv5 bootnodes",
    hidden: true,
    defaultDescription: String(defaultOptions.network.connectToDiscv5Bootnodes === true),
    group: "network",
  },

  "network.discv5FirstQueryDelayMs": {
    type: "number",
    description: "Delay the 1st heart beat of Peer Manager after starting Discv5",
    hidden: true,
    defaultDescription: String(defaultOptions.network.discv5FirstQueryDelayMs),
    group: "network",
  },

  "network.requestCountPeerLimit": {
    type: "number",
    description: "Max block req/resp requests per peer per rateTrackerTimeoutMs",
    hidden: true,
    group: "network",
    deprecated: true,
  },

  "network.blockCountTotalLimit": {
    type: "number",
    description: "Max block count requested per rateTrackerTimeoutMs",
    hidden: true,
    group: "network",
    deprecated: true,
  },

  "network.blockCountPeerLimit": {
    type: "number",
    description: "Max block count requested per peer per rateTrackerTimeoutMs",
    hidden: true,
    group: "network",
    deprecated: true,
  },

  "network.rateTrackerTimeoutMs": {
    type: "number",
    description: "Time window to track rate limit in milliseconds",
    hidden: true,
    group: "network",
    deprecated: true,
  },

  "network.dontSendGossipAttestationsToForkchoice": {
    hidden: true,
    type: "boolean",
    description: "Pass gossip attestations to forkchoice or not",
    group: "network",
  },

  "network.allowPublishToZeroPeers": {
    hidden: true,
    type: "boolean",
    description: "Don't error when publishing to zero peers",
    group: "network",
  },

  "network.gossipsubD": {
    hidden: true,
    type: "number",
    description: "Gossipsub D param",
    group: "network",
  },

  "network.gossipsubDLow": {
    hidden: true,
    type: "number",
    description: "Gossipsub D param low",
    group: "network",
  },

  "network.gossipsubDHigh": {
    hidden: true,
    type: "number",
    description: "Gossipsub D param high",
    group: "network",
  },

  "network.gossipsubAwaitHandler": {
    hidden: true,
    type: "boolean",
    group: "network",
  },

  "network.disableFloodPublish": {
    hidden: true,
    description: "Disable gossipsub flood publish",
    type: "boolean",
    group: "network",
  },

  "network.rateLimitMultiplier": {
    type: "number",
    description: "The multiplier to increase the rate limits. Set to zero to disable rate limiting.",
    hidden: true,
    defaultDescription: String(defaultOptions.network.rateLimitMultiplier),
    group: "network",
  },

  "network.maxGossipTopicConcurrency": {
    type: "number",
    hidden: true,
    group: "network",
  },

  "network.useWorker": {
    type: "boolean",
    hidden: true,
    group: "network",
  },

  "network.maxYoungGenerationSizeMb": {
    type: "number",
    hidden: true,
    group: "network",
    description: "Max size of young generation in megabytes. Defaults to 152mb",
    defaultDescription: String(defaultOptions.network.maxYoungGenerationSizeMb),
  },
};
