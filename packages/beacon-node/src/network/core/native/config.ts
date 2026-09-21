import {TopicScoreParams, defaultPeerScoreParams, defaultTopicScoreParams} from "@libp2p/gossipsub/score";
import {PrivateKey} from "@libp2p/interface";
import {ENR} from "@chainsafe/enr";
import {
  AdvertisedEndpoints,
  IpEndpoint,
  NativeApplicationConfig,
  NativeDiscoveryConfig,
  NativeLocalState,
  NativeTopicBoundary,
  NativeTopicKind,
  NativeTopicRule,
  NativeTopicScoreParams,
} from "@chainsafe/lodestar-z/network";
import {BeaconConfig} from "@lodestar/config";
import {
  ATTESTATION_SUBNET_COUNT,
  MAX_SIGNED_AGGREGATE_AND_PROOF_SIZE,
  SLOTS_PER_EPOCH,
  isForkPostFulu,
  isForkPostGloas,
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

export function gossipExecutionLimits(
  opts: NetworkOptions,
  policy: readonly NativeTopicBoundary[]
): {items: number; bytes: number}[] {
  const byteWeights = [32, 4, 8, 1, 4, 1, 2, 2, 2, 2, 1, 8, 24];
  const itemWeights = [1, 8, 32, 1, 1, 1, 2, 4, 1, 1, 1, 4, 8];
  const byteTotal = byteWeights.reduce((sum, weight) => sum + weight, 0);
  const itemTotal = itemWeights.reduce((sum, weight) => sum + weight, 0);
  const itemBudget = nativeInteger(opts.native?.hostGossipItems ?? 4096, "host gossip items", 16384, 1);
  const byteBudget = nativeInteger(opts.native?.hostGossipBytes ?? 64 * MiB, "host gossip bytes", 1024 * MiB, 1);
  const concurrency = nativeInteger(opts.maxGossipTopicConcurrency ?? itemBudget, "gossip topic concurrency", 16384, 1);
  return kinds.map((kind, i) => {
    const items = Math.min(concurrency, Math.floor((itemBudget * itemWeights[i]) / itemTotal));
    const bytes = Math.floor((byteBudget * byteWeights[i]) / byteTotal);
    const largest = Math.max(0, ...policy.map((boundary) => boundary.rules[kind].sszMax));
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

function discovery(
  opts: NetworkOptions,
  key: PrivateKey,
  listeners: readonly IpEndpoint[]
): NativeDiscoveryConfig | null {
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
  const advertisement: AdvertisedEndpoints = {};
  for (const family of [4, 6] as const) {
    const udp = enr.getLocationMultiaddr(family === 4 ? "udp4" : "udp6");
    const quic = enr.getLocationMultiaddr(family === 4 ? "quic4" : "quic6");
    if (
      (udp && !bind.some((endpoint) => endpoint.family === family)) ||
      (quic && !listeners.some((endpoint) => endpoint.family === family))
    ) {
      throw new NativeNetworkError({
        code: NativeNetworkErrorCode.CONFIGURATION,
        resource: "advertised address family has no listener",
      });
    }
    const address = quic ?? udp;
    if (!address) continue;
    const endpoint = parseNativeEndpoint(address.toString(), quic !== undefined);
    if (family === 4) {
      advertisement.ip4 = endpoint.address;
      if (udp) advertisement.udp = parseNativeEndpoint(udp.toString(), false).port;
      if (quic) advertisement.quic = endpoint.port;
    } else {
      advertisement.ip6 = endpoint.address;
      if (udp) advertisement.udp6 = parseNativeEndpoint(udp.toString(), false).port;
      if (quic) advertisement.quic6 = endpoint.port;
    }
  }
  if (
    (advertisement.quic === undefined && advertisement.quic6 === undefined) ||
    (advertisement.udp === undefined && advertisement.udp6 === undefined)
  ) {
    throw new NativeNetworkError({
      code: NativeNetworkErrorCode.CONFIGURATION,
      resource: "missing advertised discovery or QUIC address",
    });
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
  nativeInteger(opts.targetPeers, "target peers", opts.maxPeers, 1);
  nativeInteger(opts.targetGroupPeers, "target group peers", opts.maxPeers, 1);
  nativeInteger(opts.slotsToSubscribeBeforeAggregatorDuty, "aggregator lookahead", 2 * SLOTS_PER_EPOCH);
  nativeInteger(config.MAX_PAYLOAD_SIZE, "max payload", 10 * MiB, 1);
  nativeInteger(config.SUBNETS_PER_NODE, "long lived subnets", ATTESTATION_SUBNET_COUNT, 1);
  nativeInteger(config.EPOCHS_PER_SUBNET_SUBSCRIPTION, "subnet subscription epochs", Number.MAX_SAFE_INTEGER, 1);
  nativeInteger(config.NUMBER_OF_CUSTODY_GROUPS, "custody group count", 128, 1);
  nativeInteger(config.SAMPLES_PER_SLOT, "sampling groups", config.NUMBER_OF_CUSTODY_GROUPS, 1);
  nativeInteger(config.DATA_COLUMN_SIDECAR_SUBNET_COUNT, "column subnets", 128, 1);
  nativeInteger(config.BLOB_SIDECAR_SUBNET_COUNT, "blob subnets", 128, 1);
  nativeInteger(config.BLOB_SIDECAR_SUBNET_COUNT_ELECTRA, "electra blob subnets", 128, 1);
  nativeInteger(config.forkBoundariesAscendingEpochOrder.length, "fork boundaries", 64, 1);
  nativeInteger(config.BLOB_SCHEDULE.length, "blob schedule", 62);
  nativeInteger(opts.directPeers?.length ?? 0, "direct peers", opts.maxPeers);
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
  application: NativeApplicationConfig;
  network: NetworkConfig;
  executionLimits: {items: number; bytes: number}[];
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
    (boundary, index, all) =>
      boundary.epoch !== Infinity && boundary.epoch !== all[index + 1]?.epoch && !isForkPostGloas(boundary.fork)
  );
  const small = opts.native?.profile === "small";
  const connections = Math.min(256, Math.max(16, opts.maxPeers + (small ? 4 : 32)));
  const listeners = nativeListeners(opts.localMultiaddrs, true);
  const topicPolicy = boundaries.map((boundary) => {
    const rules = Object.fromEntries(kinds.map((kind) => [kind, {count: 0, sszMin: 0, sszMax: 0}])) as Record<
      NativeTopicKind,
      NativeTopicRule
    >;
    for (const type of getCoreTopicsAtFork(network, boundary.fork, {
      subscribeAllSubnets: true,
      subscribeAllColumnSubnets: true,
    })) {
      const kind = kinds.find((kind) => kind === type.type);
      if (!kind)
        throw new NativeNetworkError({code: NativeNetworkErrorCode.CONFIGURATION, resource: `topic ${type.type}`});
      const topic = {...type, boundary};
      const schema = getGossipSSZType(topic);
      rules[kind] = {
        count: rules[kind].count + 1,
        sszMin: schema.minSize,
        sszMax: Math.min(config.MAX_PAYLOAD_SIZE, getGossipSSZMaxSize(topic, config.MAX_PAYLOAD_SIZE, schema)),
      };
    }
    return {digest: config.forkBoundary2ForkDigest(boundary), rules};
  });
  const application: NativeApplicationConfig = {
    profile: opts.native?.profile ?? "beaconNode",
    bind: listeners,
    discovery: discovery(opts, key, listeners),
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
      dialingCapacity: Math.min(connections, small ? 4 : 16),
      receiveBudgetBytes: opts.native?.receiveBudgetBytes ?? (small ? 64 : 512) * MiB,
      nativeBudgetBytes: opts.native?.nativeBudgetBytes ?? (small ? 512 : 768) * MiB,
      bridgeBudgetBytes: opts.native?.bridgeBudgetBytes ?? 512 * MiB,
    },
    gossipPolicy: {
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
  const items: Record<NativeTopicKind, number> = {
    beacon_block: 8,
    beacon_attestation: Math.max(128, Math.ceil((activeValidatorCount / SLOTS_PER_EPOCH) * 1.1)),
    beacon_aggregate_and_proof: 2048,
    blob_sidecar: 256,
    data_column_sidecar: 256,
    sync_committee: 1024,
    sync_committee_contribution_and_proof: 128,
    proposer_slashing: 32,
    attester_slashing: 32,
    voluntary_exit: 128,
    bls_to_execution_change: 128,
    light_client_finality_update: 8,
    light_client_optimistic_update: 8,
  };
  const byteWeights = [24, 8, 8, 1, 4, 1, 2, 2, 2, 2, 1, 8, 16];
  application.gossipPolicy.processor = kinds.map((kind, i) => {
    const largest = Math.max(0, ...topicPolicy.map((boundary) => boundary.rules[kind].sszMax));
    const compressedMax = 32 + largest + Math.floor(largest / 6);
    const pages = Math.ceil(Math.max(4096, compressedMax, byteWeights[i] * MiB) / 4096);
    return {items: items[kind], bytes: pages * 4096};
  });
  nativeInteger(
    application.gossipPolicy.processor.reduce((sum, limit) => sum + limit.items, 0),
    "gossip work capacity",
    65535,
    1
  );
  const executionLimits = gossipExecutionLimits(opts, topicPolicy);
  return {application, network, executionLimits, directPeers};
}
