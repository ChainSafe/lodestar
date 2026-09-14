import {TopicScoreParams, defaultPeerScoreParams, defaultTopicScoreParams} from "@libp2p/gossipsub/score";
import {PrivateKey} from "@libp2p/interface";
import {ENR} from "@chainsafe/enr";
import {
  AdvertisedEndpoints,
  IpEndpoint,
  NativeApplicationConfig,
  NativeDiscoveryConfig,
  NativeForkSchedule,
  NativeLocalState,
  NativeTopicKind,
  NativeTopicRule,
  NativeTopicScoreParams,
} from "@chainsafe/lodestar-z/network";
import {BeaconConfig} from "@lodestar/config";
import {
  ATTESTATION_SUBNET_COUNT,
  ForkName,
  MAX_SIGNED_AGGREGATE_AND_PROOF_SIZE,
  NUMBER_OF_COLUMNS,
  SLOTS_PER_EPOCH,
  isForkPostFulu,
  isForkPostGloas,
} from "@lodestar/params";
import {Status} from "@lodestar/types";
import {CustodyConfig} from "../../../util/dataColumns.js";
import {getCurrentAndNextForkBoundary} from "../../forks.js";
import {computeGossipPeerScoreParams, gossipScoreThresholds} from "../../gossip/scoringParameters.js";
import {getCoreTopicsAtFork, getGossipSSZMaxSize, getGossipSSZType} from "../../gossip/topic.js";
import {getENRForkID} from "../../metadata.js";
import {NetworkConfig} from "../../networkConfig.js";
import {NetworkOptions} from "../../options.js";
import {computeNodeIdFromPrivateKey} from "../../subnets/interface.js";
import {nativePeerId, parseNativeEndpoint} from "./addresses.js";
import {NativeNetworkError, NativeNetworkErrorCode, nativeInteger} from "./errors.js";
import {nativeCapabilities, nativeFork} from "./protocols.js";

export const UINT64_MAX = 18446744073709551615n;
const MiB = 1024 * 1024;
const kinds: readonly NativeTopicKind[] = [
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

export function nativeTopicScore(params: TopicScoreParams): NativeTopicScoreParams {
  return {
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
  const epoch = Math.floor(slot / SLOTS_PER_EPOCH);
  const digest = config.forkBoundary2ForkDigest(config.getForkBoundaryAtEpoch(epoch));
  return {
    status: {
      forkDigest: digest,
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
    fork: {
      fork: nativeFork(fork),
      digest,
      custodyGroups: config.NUMBER_OF_CUSTODY_GROUPS,
      minimumSamplingGroups: isForkPostFulu(fork) ? config.SAMPLES_PER_SLOT : 0,
    },
  };
}

export function nativeForkSchedule(config: BeaconConfig, slot: number): NativeForkSchedule {
  const epoch = Math.floor(slot / SLOTS_PER_EPOCH);
  const enr = getENRForkID(config, epoch);
  const {nextBoundary} = getCurrentAndNextForkBoundary(config, epoch);
  return {
    fuluScheduled: config.FULU_FORK_EPOCH !== Infinity,
    nextVersion: enr.nextForkVersion,
    nextEpoch: nextBoundary ? BigInt(nativeInteger(nextBoundary.epoch, "next fork epoch")) : UINT64_MAX,
    nextDigest: nextBoundary ? config.forkBoundary2ForkDigest(nextBoundary) : new Uint8Array(4),
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
    if (typeof address !== "string" || address.length > 256)
      throw new NativeNetworkError({code: NativeNetworkErrorCode.CONFIGURATION, resource: "bootstrap address length"});
    const peer = address.split("/p2p/")[1];
    nativePeerId(peer);
    parseNativeEndpoint(address, true, peer);
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
): {application: NativeApplicationConfig; network: NetworkConfig} {
  validateOptions(opts, config);
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
    ...computeGossipPeerScoreParams({
      config,
      eth2Context: {activeValidatorCount, currentSlot: slot, currentEpoch: Math.floor(slot / SLOTS_PER_EPOCH)},
    }),
  };
  const boundaries = config.forkBoundariesAscendingEpochOrder.filter(
    (boundary, index, all) =>
      boundary.epoch !== Infinity && boundary.epoch !== all[index + 1]?.epoch && !isForkPostGloas(boundary.fork)
  );
  const requestForks = boundaries.map((boundary) => ({
    digest: config.forkBoundary2ForkDigest(boundary),
    fork: nativeFork(boundary.fork),
  }));
  const blobSchedule = [
    config.DENEB_FORK_EPOCH,
    config.ELECTRA_FORK_EPOCH,
    ...config.BLOB_SCHEDULE.map((entry) => entry.EPOCH),
  ]
    .filter((epoch, index, all) => epoch !== Infinity && all.indexOf(epoch) === index)
    .map((epoch) => ({
      startSlot: BigInt(nativeInteger(epoch * SLOTS_PER_EPOCH, "blob fork slot")),
      maxBlobs: config.getMaxBlobsPerBlock(epoch),
    }));
  const small = opts.native?.profile === "small";
  const connections = Math.min(256, Math.max(16, opts.maxPeers + (small ? 4 : 32)));
  const listeners = nativeListeners(opts.localMultiaddrs, true);
  const application: NativeApplicationConfig = {
    profile: opts.native?.profile ?? "beaconNode",
    bind: listeners,
    discovery: discovery(opts, key, listeners),
    initialSlot: BigInt(Math.max(0, slot)),
    local,
    forkSchedule: nativeForkSchedule(config, slot),
    requestForks,
    capabilities: nativeCapabilities(config, config.getForkName(slot), opts.disableLightClientServer ?? false),
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
      nativeBudgetBytes: opts.native?.nativeBudgetBytes ?? (small ? 80 : 256) * MiB,
      bridgeBudgetBytes: opts.native?.bridgeBudgetBytes ?? 512 * MiB,
    },
    requestPolicy: {
      denebStartSlot:
        config.DENEB_FORK_EPOCH === Infinity
          ? null
          : BigInt(nativeInteger(config.DENEB_FORK_EPOCH * SLOTS_PER_EPOCH, "deneb slot")),
      blocksPreDeneb: config.MAX_REQUEST_BLOCKS,
      blocksDeneb: config.MAX_REQUEST_BLOCKS_DENEB,
      blobIdentifiersDeneb: config.MAX_REQUEST_BLOB_SIDECARS,
      blobIdentifiersElectra: config.MAX_REQUEST_BLOB_SIDECARS_ELECTRA,
      numberOfColumns: NUMBER_OF_COLUMNS,
      columnChunks: config.MAX_REQUEST_DATA_COLUMN_SIDECARS,
      blobSchedule,
      hostIntegerMax: BigInt(Number.MAX_SAFE_INTEGER),
    },
    topicPolicy: boundaries.map((boundary) => {
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
    }),
    gossipPolicy: {
      phase0Digest: boundaries[0]?.fork === ForkName.phase0 ? config.forkBoundary2ForkDigest(boundaries[0]) : null,
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
        appWeight: score.appSpecificWeight,
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
        defaultTopic: nativeTopicScore(defaultTopicScoreParams),
      },
    },
    identitySecretKey: Uint8Array.from(key.raw),
  };
  return {application, network};
}
