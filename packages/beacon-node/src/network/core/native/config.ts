import {PrivateKey} from "@libp2p/interface";
import {ENR} from "@chainsafe/enr";
import bindings from "@chainsafe/lodestar-z";
import {
  AdvertisedEndpoints,
  IpEndpoint,
  NativeApplicationConfig,
  NativeDiscoveryConfig,
  NativeLocalState,
  NativeTopicKind,
} from "@chainsafe/lodestar-z/network";
import {BeaconConfig} from "@lodestar/config";
import {ATTESTATION_SUBNET_COUNT, SLOTS_PER_EPOCH, isForkPostFulu} from "@lodestar/params";
import {Status} from "@lodestar/types";
import {CustodyConfig} from "../../../util/dataColumns.js";
import {NetworkConfig} from "../../networkConfig.js";
import {NetworkOptions} from "../../options.js";
import {computeNodeIdFromPrivateKey} from "../../subnets/interface.js";
import {NativePeerAddress, parseNativeEndpoint, parseNativePeerAddress} from "./addresses.js";
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
  directPeers: NativePeerAddress[];
  bootPeers: NativePeerAddress[];
} {
  validateOptions(opts, config);
  const directPeers = (opts.directPeers ?? []).map(parseNativePeerAddress);
  const bootPeers = (opts.bootMultiaddrs ?? []).map((address) => {
    if (typeof address !== "string" || address.length > 256 || !address.startsWith("/"))
      throw new NativeNetworkError({code: NativeNetworkErrorCode.CONFIGURATION, resource: "bootstrap address"});
    return parseNativePeerAddress(address);
  });
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
  const listeners = nativeListeners(opts.localMultiaddrs, true);
  const application: Omit<NativeApplicationConfig, "logLevel"> = {
    traceGossip: opts.native?.traceGossip ?? false,
    traceTurns: opts.native?.traceTurns ?? false,
    ...(opts.xrayAddress ? {xray: {address: opts.xrayAddress, waitForAttach: opts.xrayWaitForAttach ?? false}} : {}),
    transport: {
      initialCongestionWindowPackets: nativeInteger(
        opts.native?.initialCongestionWindowPackets ?? 10,
        "initial congestion window packets",
        64,
        1
      ),
      receiveDatagramsPerTurn: nativeInteger(
        opts.native?.receiveDatagramsPerTurn ?? 32,
        "receive datagrams per turn",
        256,
        1
      ),
    },
    beaconConfig: new bindings.BeaconConfig(config, config.genesisValidatorsRoot),
    activeValidatorCount,
    bind: listeners,
    discovery: discovery(opts, key),
    initialSlot: BigInt(Math.max(0, slot)),
    local,
    serveLightClients: !(opts.disableLightClientServer ?? false),
    identify: {agentVersion: opts.private ? "" : `Lodestar/${opts.version ?? "dev"}`, protocolVersion: "eth2/1.0.0"},
    resources: {
      targetPeers: opts.targetPeers,
      maxPeers: opts.maxPeers,
      receiveBudgetBytes: opts.native?.receiveBudgetBytes ?? 512 * MiB,
      nativeBudgetBytes: opts.native?.nativeBudgetBytes ?? 2048 * MiB,
      bridgeBudgetBytes: opts.native?.bridgeBudgetBytes ?? 512 * MiB,
    },
    gossipPolicy: {
      hostItems: nativeInteger(opts.native?.hostGossipItems ?? 4096, "host gossip items", 16384, 1),
      hostBytes: nativeInteger(opts.native?.hostGossipBytes ?? 64 * MiB, "host gossip bytes", 1024 * MiB, 1),
      topicConcurrency: nativeInteger(opts.maxGossipTopicConcurrency ?? 16384, "gossip topic concurrency", 16384, 1),
      activeSendTimeoutMs: BigInt(
        nativeInteger(opts.native?.gossipActiveSendTimeoutMs ?? 6000, "gossip active send timeout", 86400000, 1)
      ),
      activeSendItems: opts.native?.gossipActiveSendItems,
      largeFrameTimeoutMs: BigInt(
        nativeInteger(opts.native?.gossipLargeFrameTimeoutMs ?? 6000, "gossip large frame timeout", 86400000, 1)
      ),
      receiveBufferBytes: nativeInteger(
        opts.native?.gossipReceiveBufferBytes ?? 128 * MiB,
        "gossip receive buffer bytes",
        1024 * MiB,
        4096
      ),
    },
    identitySecretKey: Uint8Array.from(key.raw),
  };
  return {application, network, directPeers, bootPeers};
}
