import bindings from "@chainsafe/lodestar-z";
import {TopicScoreParams, defaultPeerScoreParams, defaultTopicScoreParams} from "@libp2p/gossipsub/score";
import {PrivateKey} from "@libp2p/interface";
import {ENR} from "@chainsafe/enr";
import {
  AdvertisedEndpoints,
  IpEndpoint,
  NativeApplicationConfig,
  NativeDiscoveryConfig,
  NativeLocalState,
  NativeTopicKind,
  NativeTopicScoreParams,
} from "@chainsafe/lodestar-z/network";
import {BeaconConfig} from "@lodestar/config";
import {
  ATTESTATION_SUBNET_COUNT,
  MAX_SIGNED_AGGREGATE_AND_PROOF_SIZE,
  SLOTS_PER_EPOCH,
  isForkPostFulu,
} from "@lodestar/params";
import {Status} from "@lodestar/types";
import {CustodyConfig} from "../../../util/dataColumns.js";
import {computeGossipPeerScoreParamsByKind, gossipScoreThresholds} from "../../gossip/scoringParameters.js";
import {getCoreTopicsAtFork, getGossipSSZMaxSize, getGossipSSZType} from "../../gossip/topic.js";
import {NetworkConfig} from "../../networkConfig.js";
import {NetworkOptions} from "../../options.js";
import {computeNodeIdFromPrivateKey} from "../../subnets/interface.js";
import {NativeDirectPeer, parseNativeDirectPeer, parseNativeEndpoint} from "./addresses.js";
import {NativeNetworkError, NativeNetworkErrorCode, nativeInteger} from "./errors.js";
import {nativeFork} from "./protocols.js";

export const UINT64_MAX = 18446744073709551615n;
const MiB = 1024 * 1024;
export const kinds: readonly NativeTopicKind[] = [
  "beacon_block",
  "beacon_aggregate_and_proof",
  "beacon_attestation",
  "proposer_slashing",
  "attester_slashing",
  "voluntary_exit",
  "sync_committee_contribution_and_proof",
  "sync_committee",
  "light_client_finality_update",
  "light_client_optimistic_update",
  "bls_to_execution_change",
  "blob_sidecar",
  "data_column_sidecar",
];

/**
 * Native gossip limits per kind. The processor holds up to `items` messages of the kind in `minMiB` MiB, or in its
 * largest compressed message when that is larger. The host executes a share of its gossip item and byte budgets, in
 * proportion to the kind's `executionItems` and `executionBytes` weights.
 */
const gossipKindLimits: Readonly<
  Record<NativeTopicKind, {items: number; minMiB: number; executionItems: number; executionBytes: number}>
> = {
  beacon_block: {items: 8, minMiB: 24, executionItems: 1, executionBytes: 32},
  beacon_aggregate_and_proof: {items: 2048, minMiB: 8, executionItems: 8, executionBytes: 4},
  // `items` rises to one slot of attesters with 10% headroom
  beacon_attestation: {items: 128, minMiB: 8, executionItems: 32, executionBytes: 8},
  proposer_slashing: {items: 32, minMiB: 1, executionItems: 1, executionBytes: 1},
  attester_slashing: {items: 32, minMiB: 4, executionItems: 1, executionBytes: 4},
  voluntary_exit: {items: 128, minMiB: 1, executionItems: 1, executionBytes: 1},
  sync_committee_contribution_and_proof: {items: 128, minMiB: 2, executionItems: 2, executionBytes: 2},
  sync_committee: {items: 1024, minMiB: 2, executionItems: 4, executionBytes: 2},
  light_client_finality_update: {items: 8, minMiB: 2, executionItems: 1, executionBytes: 2},
  light_client_optimistic_update: {items: 8, minMiB: 2, executionItems: 1, executionBytes: 2},
  bls_to_execution_change: {items: 128, minMiB: 1, executionItems: 1, executionBytes: 1},
  blob_sidecar: {items: 256, minMiB: 8, executionItems: 4, executionBytes: 8},
  data_column_sidecar: {items: 256, minMiB: 16, executionItems: 8, executionBytes: 24},
};

function gossipExecutionLimits(
  opts: NetworkOptions,
  maxSszSizes: Readonly<Record<NativeTopicKind, number>>
): {items: number; bytes: number}[] {
  const limits = Object.values(gossipKindLimits);
  const byteTotal = limits.reduce((sum, limit) => sum + limit.executionBytes, 0);
  const itemTotal = limits.reduce((sum, limit) => sum + limit.executionItems, 0);
  const itemBudget = nativeInteger(opts.native?.hostGossipItems ?? 4096, "host gossip items", 16384, 1);
  const byteBudget = nativeInteger(opts.native?.hostGossipBytes ?? 64 * MiB, "host gossip bytes", 1024 * MiB, 1);
  const concurrency = nativeInteger(opts.maxGossipTopicConcurrency ?? itemBudget, "gossip topic concurrency", 16384, 1);
  return kinds.map((kind) => {
    const {executionItems, executionBytes} = gossipKindLimits[kind];
    const items = Math.min(concurrency, Math.floor((itemBudget * executionItems) / itemTotal));
    const bytes = Math.floor((byteBudget * executionBytes) / byteTotal);
    const largest = maxSszSizes[kind];
    if (items < 1 || bytes < largest)
      throw new NativeNetworkError({
        code: NativeNetworkErrorCode.CONFIGURATION,
        resource: `gossip execution capacity for ${kind}`,
      });
    return {items, bytes};
  });
}

export function nativeTopicScore(params: TopicScoreParams, meshDeliveryStartSlot = 0): NativeTopicScoreParams {
  return {
    meshDeliveryStartSlot: BigInt(nativeInteger(meshDeliveryStartSlot, "mesh delivery start slot")),
    weight: params.topicWeight,
    timeInMeshWeight: params.timeInMeshWeight,
    timeInMeshCap: params.timeInMeshCap,
    timeInMeshQuantumMs: BigInt(nativeInteger(params.timeInMeshQuantum, "mesh score quantum")),
    firstDeliveryWeight: params.firstMessageDeliveriesWeight,
    firstDeliveryCap: params.firstMessageDeliveriesCap,
    firstDeliveryDecay: params.firstMessageDeliveriesDecay,
    meshDeliveryWeight: params.meshMessageDeliveriesWeight,
    meshDeliveryThreshold: params.meshMessageDeliveriesThreshold,
    meshDeliveryCap: params.meshMessageDeliveriesCap,
    meshDeliveryDecay: params.meshMessageDeliveriesDecay,
    meshDeliveryActivationMs: BigInt(nativeInteger(params.meshMessageDeliveriesActivation, "mesh activation")),
    meshDeliveryWindowMs: BigInt(nativeInteger(params.meshMessageDeliveriesWindow, "mesh window")),
    meshFailureWeight: params.meshFailurePenaltyWeight,
    meshFailureDecay: params.meshFailurePenaltyDecay,
    invalidWeight: params.invalidMessageDeliveriesWeight,
    invalidDecay: params.invalidMessageDeliveriesDecay,
  };
}

export function nativeLocalState(
  config: BeaconConfig,
  status: Status,
  slot: number,
  custodyGroupCount: number
): NativeLocalState {
  nativeInteger(slot, "clock slot", Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER);
  const fork = config.getForkName(slot);
  nativeFork(fork);
  return {
    status: {
      finalizedRoot: status.finalizedRoot,
      headRoot: status.headRoot,
      finalizedEpoch: BigInt(nativeInteger(status.finalizedEpoch, "finalized epoch")),
      headSlot: BigInt(nativeInteger(status.headSlot, "head slot")),
      earliestAvailableSlot: isForkPostFulu(fork)
        ? BigInt(
            nativeInteger(
              "earliestAvailableSlot" in status ? status.earliestAvailableSlot : NaN,
              "earliest available slot"
            )
          )
        : null,
    },
    metadata: {
      sequenceNumber: 0n,
      attnets: new Uint8Array(8),
      syncnets: 0,
      custodyGroupCount: BigInt(nativeInteger(custodyGroupCount, "custody groups", config.NUMBER_OF_CUSTODY_GROUPS, 1)),
    },
  };
}

function discovery(opts: NetworkOptions, key: PrivateKey): NativeDiscoveryConfig | null {
  if (!opts.discv5) return null;
  const {bindAddrs, bootEnrs, config} = opts.discv5;
  if (config && Object.keys(config).length > 0) {
    throw new NativeNetworkError({
      code: NativeNetworkErrorCode.CONFIGURATION,
      resource: "native discovery requires default discovery settings",
    });
  }
  nativeInteger(bootEnrs.length, "bootstrap ENRs", 64);
  if (opts.discv5.enr.length > 404)
    throw new NativeNetworkError({code: NativeNetworkErrorCode.CONFIGURATION, resource: "ENR length"});
  const enr = ENR.decodeTxt(opts.discv5.enr);
  if (
    enr.publicKey.length !== key.publicKey.raw.length ||
    !enr.publicKey.every((byte, index) => byte === key.publicKey.raw[index]) ||
    enr.seq < 0n ||
    enr.seq >= UINT64_MAX
  ) {
    throw new NativeNetworkError({code: NativeNetworkErrorCode.CONFIGURATION, resource: "ENR identity or sequence"});
  }
  if (enr.tcp !== undefined || enr.tcp6 !== undefined) {
    throw new NativeNetworkError({
      code: NativeNetworkErrorCode.CONFIGURATION,
      resource: "native advertisement requires TCP disabled",
    });
  }
  const bind = nativeListeners(
    [bindAddrs.ip4, bindAddrs.ip6].filter((address) => address !== undefined),
    false
  );
  for (const [family, address] of [
    [4, bindAddrs.ip4],
    [6, bindAddrs.ip6],
  ] as const) {
    if (address && parseNativeEndpoint(address, false).family !== family) {
      throw new NativeNetworkError({
        code: NativeNetworkErrorCode.CONFIGURATION,
        resource: "discovery bind address family",
      });
    }
  }
  const fixed: AdvertisedEndpoints = {};
  const explicit = opts.native?.discovery?.fixed;
  for (const [family, ipKey, udpKey, quicKey] of [
    [4, "ip4", "udp", "quic"],
    [6, "ip6", "udp6", "quic6"],
  ] as const) {
    const ip = explicit?.[ipKey];
    if (ip !== undefined) fixed[ipKey] = parseNativeEndpoint(`/ip${family}/${ip}/udp/1`, false).address;
    for (const portKey of [udpKey, quicKey]) {
      const port = explicit?.[portKey];
      if (port !== undefined) fixed[portKey] = nativeInteger(port, "advertised port", 65535, 1);
    }
  }
  const initialText = opts.native?.discovery?.initialEnr;
  if (initialText !== undefined && initialText.length > 404)
    throw new NativeNetworkError({code: NativeNetworkErrorCode.CONFIGURATION, resource: "initial ENR length"});
  const initial = initialText === undefined ? enr : ENR.decodeTxt(initialText);
  if (!initial.publicKey.every((byte, index) => byte === key.publicKey.raw[index]))
    throw new NativeNetworkError({code: NativeNetworkErrorCode.CONFIGURATION, resource: "initial ENR identity"});
  const advertisement: AdvertisedEndpoints = {};
  for (const [family, ipKey, udpKey] of [
    [4, "ip4", "udp"],
    [6, "ip6", "udp6"],
  ] as const) {
    if (!bind.some((endpoint) => endpoint.family === family)) continue;
    const udp = initial.getLocationMultiaddr(family === 4 ? "udp4" : "udp6");
    if (!udp) continue;
    const endpoint = parseNativeEndpoint(udp.toString(), false);
    advertisement[ipKey] = endpoint.address;
    if (endpoint.port > 0) advertisement[udpKey] = endpoint.port;
  }
  return {
    bind,
    sequenceNumber: enr.seq + 1n,
    bootstrapEnrs: bootEnrs.map((text) => {
      if (text.length > 404)
        throw new NativeNetworkError({code: NativeNetworkErrorCode.CONFIGURATION, resource: "bootstrap ENR length"});
      return ENR.decodeTxt(text).encode();
    }),
    advertisement,
    fixed,
  };
}

function nativeListeners(addresses: readonly string[], quic: boolean): IpEndpoint[] {
  if (addresses.length < 1 || addresses.length > 2) {
    throw new NativeNetworkError({
      code: NativeNetworkErrorCode.CONFIGURATION,
      resource: "native networking requires one listener per IP family",
    });
  }
  const endpoints = addresses.map((address) => parseNativeEndpoint(address, quic));
  if (endpoints.length === 2 && endpoints[0].family === endpoints[1].family) {
    throw new NativeNetworkError({
      code: NativeNetworkErrorCode.CONFIGURATION,
      resource: "duplicate listener address family",
    });
  }
  return endpoints;
}

function validateOptions(opts: NetworkOptions, config: BeaconConfig): void {
  for (const fork of config.forksAscendingEpochOrder) {
    if (fork.epoch !== Infinity) nativeFork(fork.name);
  }
  if (opts.tcp !== false || opts.quic === false) {
    throw new NativeNetworkError({
      code: NativeNetworkErrorCode.CONFIGURATION,
      resource: "native backend requires TCP disabled and QUIC enabled",
    });
  }
  const unsupported =
    opts.mdns ||
    opts.connectToDiscv5Bootnodes ||
    opts.gossipsubAwaitHandler ||
    opts.disablePeerScoring ||
    (opts.rateLimitMultiplier !== undefined && opts.rateLimitMultiplier !== 1) ||
    (opts.protocolPrefix !== undefined && opts.protocolPrefix !== "/eth2/beacon_chain/req") ||
    (opts.gossipsubD !== undefined && opts.gossipsubD !== 8) ||
    (opts.gossipsubDLow !== undefined && opts.gossipsubDLow !== 6) ||
    (opts.gossipsubDHigh !== undefined && opts.gossipsubDHigh !== 12) ||
    opts.discv5FirstQueryDelayMs !== undefined;
  if (unsupported)
    throw new NativeNetworkError({
      code: NativeNetworkErrorCode.CONFIGURATION,
      resource: "unsupported native network option",
    });
  if (opts.dialTimeoutMs !== undefined || opts.requestTimeoutMs !== undefined || opts.respTimeoutMs !== undefined)
    throw new NativeNetworkError({
      code: NativeNetworkErrorCode.CONFIGURATION,
      resource: "native control RPC timeout overrides",
    });
  nativeInteger(opts.maxPeers, "max peers", 256, 2);
  nativeInteger(opts.targetPeers, "target peers", opts.maxPeers - 1, 1);
  nativeInteger(opts.targetGroupPeers, "target group peers", opts.maxPeers, 1);
  nativeInteger(opts.slotsToSubscribeBeforeAggregatorDuty, "aggregator lookahead", 2 * SLOTS_PER_EPOCH);
  nativeInteger(config.SUBNETS_PER_NODE, "long lived subnets", ATTESTATION_SUBNET_COUNT, 1);
  nativeInteger(config.EPOCHS_PER_SUBNET_SUBSCRIPTION, "subnet subscription epochs", Number.MAX_SAFE_INTEGER, 1);
  nativeInteger(config.DATA_COLUMN_SIDECAR_SUBNET_COUNT, "column subnets", 128, 1);
  nativeInteger(config.BLOB_SIDECAR_SUBNET_COUNT, "blob subnets", 128, 1);
  nativeInteger(config.BLOB_SIDECAR_SUBNET_COUNT_ELECTRA, "electra blob subnets", 128, 1);
  nativeInteger(config.forkBoundariesAscendingEpochOrder.length, "fork boundaries", 64, 1);
  nativeInteger(
    opts.directPeers?.length ?? 0,
    "direct peers",
    opts.targetPeers - Math.max(1, Math.floor(opts.targetPeers / 4))
  );
  nativeInteger(opts.bootMultiaddrs?.length ?? 0, "bootstrap peers", 64);
  for (const address of opts.bootMultiaddrs ?? []) {
    if (typeof address !== "string" || address.length > 256 || !address.startsWith("/"))
      throw new NativeNetworkError({code: NativeNetworkErrorCode.CONFIGURATION, resource: "bootstrap address"});
    parseNativeDirectPeer(address);
  }
}

export function createNativeConfig(
  opts: NetworkOptions,
  config: BeaconConfig,
  key: PrivateKey,
  slot: number,
  status: Status,
  custodyGroupCount: number,
  activeValidatorCount: number
): {
  /** The network selects the log level from its logger at initialization. */
  application: Omit<NativeApplicationConfig, "logLevel">;
  network: NetworkConfig;
  directPeers: NativeDirectPeer[];
} {
  validateOptions(opts, config);
  const directPeers = (opts.directPeers ?? []).map(parseNativeDirectPeer);
  if (key.type !== "secp256k1")
    throw new NativeNetworkError({code: NativeNetworkErrorCode.CONFIGURATION, resource: "secp256k1 identity required"});
  nativeInteger(activeValidatorCount, "active validators", Number.MAX_SAFE_INTEGER, 1);
  const local = nativeLocalState(config, status, slot, custodyGroupCount);
  const nodeId = computeNodeIdFromPrivateKey(key);
  const network: NetworkConfig = {
    config,
    nodeId,
    custodyConfig: new CustodyConfig({config, nodeId, initialCustodyGroupCount: custodyGroupCount}),
  };
  const score = {
    ...defaultPeerScoreParams,
    ...computeGossipPeerScoreParamsByKind(config, activeValidatorCount),
  };
  const boundaries = config.forkBoundariesAscendingEpochOrder.filter(
    (boundary, index, all) => boundary.epoch !== Infinity && boundary.epoch !== all[index + 1]?.epoch
  );
  const small = opts.native?.profile === "small";
  const connections = Math.min(256, Math.max(16, opts.maxPeers + (small ? 4 : 32)));
  const listeners = nativeListeners(opts.localMultiaddrs, true);
  const maxSszSizes = Object.fromEntries(kinds.map((kind) => [kind, 0])) as Record<NativeTopicKind, number>;
  for (const boundary of boundaries) {
    for (const type of getCoreTopicsAtFork(network, boundary.fork, {
      subscribeAllSubnets: true,
      subscribeAllColumnSubnets: true,
    })) {
      const kind = kinds.find((kind) => kind === type.type);
      if (!kind)
        throw new NativeNetworkError({code: NativeNetworkErrorCode.CONFIGURATION, resource: `topic ${type.type}`});
      const topic = {...type, boundary};
      const schema = getGossipSSZType(topic);
      maxSszSizes[kind] = Math.max(
        maxSszSizes[kind],
        Math.min(config.MAX_PAYLOAD_SIZE, getGossipSSZMaxSize(topic, config, schema))
      );
    }
  }
  const processor = kinds.map((kind) => {
    const {items, minMiB} = gossipKindLimits[kind];
    const largest = maxSszSizes[kind];
    const compressedMax = 32 + largest + Math.floor(largest / 6);
    const pages = Math.ceil(Math.max(4096, compressedMax, minMiB * MiB) / 4096);
    return {
      items:
        kind === "beacon_attestation"
          ? Math.max(items, Math.ceil((activeValidatorCount / SLOTS_PER_EPOCH) * 1.1))
          : items,
      bytes: pages * 4096,
    };
  });
  nativeInteger(
    processor.reduce((sum, limit) => sum + limit.items, 0),
    "gossip work capacity",
    65535,
    1
  );
  const execution = gossipExecutionLimits(opts, maxSszSizes).map((limit, i) => ({
    items: Math.min(limit.items, processor[i].items),
    bytes: limit.bytes,
  }));
  const application: Omit<NativeApplicationConfig, "logLevel"> = {
    beaconConfig: new bindings.BeaconConfig(config, config.genesisValidatorsRoot),
    profile: opts.native?.profile ?? "beaconNode",
    bind: listeners,
    discovery: discovery(opts, key),
    initialSlot: BigInt(Math.max(0, slot)),
    local,
    serveLightClients: !(opts.disableLightClientServer ?? false),
    identify: {agentVersion: opts.private ? "" : `Lodestar/${opts.version ?? "dev"}`, protocolVersion: "eth2/1.0.0"},
    resources: {
      peerCapacity: Math.max(64, 2 * opts.maxPeers),
      targetPeers: opts.targetPeers,
      maxPeers: opts.maxPeers,
      minOutbound: Math.max(1, Math.floor(opts.targetPeers / 4)),
      outboundReserve: Math.min(small ? 4 : 32, opts.targetPeers),
      connectionCapacity: connections,
      handshakingCapacity: Math.min(connections, small ? 8 : 32),
      dialingCapacity: small ? 4 : 32,
      receiveBudgetBytes: opts.native?.receiveBudgetBytes ?? (small ? 64 : 512) * MiB,
      nativeBudgetBytes: opts.native?.nativeBudgetBytes ?? (small ? 512 : 768) * MiB,
      bridgeBudgetBytes: opts.native?.bridgeBudgetBytes ?? 512 * MiB,
    },
    gossipPolicy: {
      processor,
      execution,
      heartbeatIntervalMs: 700n,
      iwantFollowupMs: 12000n,
      idontwantMinDataSize: MAX_SIGNED_AGGREGATE_AND_PROOF_SIZE,
      validationTimeoutMs: 30000n,
      validationTombstoneMs: 30000n,
      pressureTimeoutMs: 30000n,
      txTimeoutMs: 30000n,
      largeFrameTimeoutMs: 30000n,
      seenTtlMs: BigInt(config.SLOT_DURATION_MS * SLOTS_PER_EPOCH * 2),
      retainedScoreMs: BigInt(score.retainScore),
      opportunisticGraftIntervalMs: 42000n,
      gossipFactor: 0.25,
      ipAllowlist: [],
      score: {
        ipColocationWeight: score.IPColocationFactorWeight,
        ipColocationThreshold: score.IPColocationFactorThreshold,
        behaviourWeight: score.behaviourPenaltyWeight,
        behaviourThreshold: score.behaviourPenaltyThreshold,
        behaviourDecay: score.behaviourPenaltyDecay,
        topicCap: score.topicScoreCap,
        decayIntervalMs: BigInt(score.decayInterval),
        decayToZero: score.decayToZero,
        gossipThreshold: gossipScoreThresholds.gossipThreshold,
        publishThreshold: gossipScoreThresholds.publishThreshold,
        graylistThreshold: gossipScoreThresholds.graylistThreshold,
        opportunisticGraftThreshold: gossipScoreThresholds.opportunisticGraftThreshold,
        topics: Object.fromEntries(
          kinds.map((kind) => {
            const policy = score.topics[kind] ?? {...defaultTopicScoreParams, topicWeight: 0, meshDeliveryStartSlot: 0};
            return [kind, nativeTopicScore(policy, policy.meshDeliveryStartSlot)];
          })
        ) as Record<NativeTopicKind, NativeTopicScoreParams>,
      },
    },
    identitySecretKey: Uint8Array.from(key.raw),
  };
  return {application, network, directPeers};
}
