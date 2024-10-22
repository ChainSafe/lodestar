import {GossipSub, GossipsubEvents} from "@chainsafe/libp2p-gossipsub";
import {SignaturePolicy, TopicStr} from "@chainsafe/libp2p-gossipsub/types";
import {PeerScoreParams} from "@chainsafe/libp2p-gossipsub/score";
import {MetricsRegister, TopicLabel, TopicStrToLabel} from "@chainsafe/libp2p-gossipsub/metrics";
import {BeaconConfig} from "@lodestar/config";
import {ATTESTATION_SUBNET_COUNT, ForkName, SLOTS_PER_EPOCH, SYNC_COMMITTEE_SUBNET_COUNT} from "@lodestar/params";
import {Logger, Map2d, Map2dArr} from "@lodestar/utils";

import {RegistryMetricCreator} from "../../metrics/index.js";
import {PeersData} from "../peers/peersData.js";
import {ClientKind} from "../peers/client.js";
import {GOSSIP_MAX_SIZE, GOSSIP_MAX_SIZE_BELLATRIX} from "../../constants/network.js";
import {Libp2p} from "../interface.js";
import {NetworkEvent, NetworkEventBus, NetworkEventData} from "../events.js";
import {callInNextEventLoop} from "../../util/eventLoop.js";
import {GossipTopic, GossipType} from "./interface.js";
import {GossipTopicCache, stringifyGossipTopic, getCoreTopicsAtFork} from "./topic.js";
import {DataTransformSnappy, fastMsgIdFn, msgIdFn, msgIdToStrFn} from "./encoding.js";
import {createEth2GossipsubMetrics, Eth2GossipsubMetrics} from "./metrics.js";

import {
  computeGossipPeerScoreParams,
  gossipScoreThresholds,
  GOSSIP_D,
  GOSSIP_D_HIGH,
  GOSSIP_D_LOW,
} from "./scoringParameters.js";

/** As specified in https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/phase0/p2p-interface.md */
const GOSSIPSUB_HEARTBEAT_INTERVAL = 0.7 * 1000;

const MAX_OUTBOUND_BUFFER_SIZE = 2 ** 24; // 16MB

export type Eth2Context = {
  activeValidatorCount: number;
  currentSlot: number;
  currentEpoch: number;
};

export type Eth2GossipsubModules = {
  config: BeaconConfig;
  libp2p: Libp2p;
  logger: Logger;
  metricsRegister: RegistryMetricCreator | null;
  eth2Context: Eth2Context;
  peersData: PeersData;
  events: NetworkEventBus;
};

export type Eth2GossipsubOpts = {
  allowPublishToZeroPeers?: boolean;
  gossipsubD?: number;
  gossipsubDLow?: number;
  gossipsubDHigh?: number;
  gossipsubAwaitHandler?: boolean;
  disableFloodPublish?: boolean;
  skipParamsLog?: boolean;
  disableLightClientServer?: boolean;
};

/**
 * Wrapper around js-libp2p-gossipsub with the following extensions:
 * - Eth2 message id
 * - Emits `GossipObject`, not `InMessage`
 * - Provides convenience interface:
 *   - `publishObject`
 *   - `subscribeTopic`
 *   - `unsubscribeTopic`
 *   - `handleTopic`
 *   - `unhandleTopic`
 *
 * See https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/phase0/p2p-interface.md#the-gossip-domain-gossipsub
 */
export class Eth2Gossipsub extends GossipSub {
  readonly scoreParams: Partial<PeerScoreParams>;
  private readonly config: BeaconConfig;
  private readonly logger: Logger;
  private readonly peersData: PeersData;
  private readonly events: NetworkEventBus;

  // Internal caches
  private readonly gossipTopicCache: GossipTopicCache;

  constructor(opts: Eth2GossipsubOpts, modules: Eth2GossipsubModules) {
    const {allowPublishToZeroPeers, gossipsubD, gossipsubDLow, gossipsubDHigh} = opts;
    const gossipTopicCache = new GossipTopicCache(modules.config);

    const scoreParams = computeGossipPeerScoreParams(modules);
    const {config, logger, metricsRegister, peersData, events} = modules;

    // Gossipsub parameters defined here:
    // https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/phase0/p2p-interface.md#the-gossip-domain-gossipsub
    super(modules.libp2p.services.components, {
      globalSignaturePolicy: SignaturePolicy.StrictNoSign,
      allowPublishToZeroTopicPeers: allowPublishToZeroPeers,
      D: gossipsubD ?? GOSSIP_D,
      Dlo: gossipsubDLow ?? GOSSIP_D_LOW,
      Dhi: gossipsubDHigh ?? GOSSIP_D_HIGH,
      Dlazy: 6,
      heartbeatInterval: GOSSIPSUB_HEARTBEAT_INTERVAL,
      fanoutTTL: 60 * 1000,
      mcacheLength: 6,
      mcacheGossip: 3,
      // this should be in ms
      seenTTL: config.SECONDS_PER_SLOT * SLOTS_PER_EPOCH * 2 * 1000,
      scoreParams,
      scoreThresholds: gossipScoreThresholds,
      // For a single stream, await processing each RPC before processing the next
      awaitRpcHandler: opts.gossipsubAwaitHandler,
      // For a single RPC, await processing each message before processing the next
      awaitRpcMessageHandler: opts.gossipsubAwaitHandler,
      // the default in gossipsub is 3s is not enough since lodestar suffers from I/O lag
      gossipsubIWantFollowupMs: 12 * 1000, // 12s
      fastMsgIdFn: fastMsgIdFn,
      msgIdFn: msgIdFn.bind(msgIdFn, gossipTopicCache),
      msgIdToStrFn: msgIdToStrFn,
      // Use the bellatrix max size if the merge is configured. pre-merge using this size
      // could only be an issue on outgoing payloads, its highly unlikely we will send out
      // a chunk bigger than GOSSIP_MAX_SIZE pre merge even on mainnet network.
      //
      // TODO: figure out a way to dynamically transition to the size
      dataTransform: new DataTransformSnappy(
        gossipTopicCache,
        Number.isFinite(config.BELLATRIX_FORK_EPOCH) ? GOSSIP_MAX_SIZE_BELLATRIX : GOSSIP_MAX_SIZE
      ),
      metricsRegister: metricsRegister as MetricsRegister | null,
      metricsTopicStrToLabel: metricsRegister
        ? getMetricsTopicStrToLabel(config, {disableLightClientServer: opts.disableLightClientServer ?? false})
        : undefined,
      asyncValidation: true,

      maxOutboundBufferSize: MAX_OUTBOUND_BUFFER_SIZE,
      // serialize message once and send to all peers when publishing
      batchPublish: true,
      // if this is false, only publish to mesh peers. If there is not enough GOSSIP_D mesh peers,
      // publish to some more topic peers to make sure we always publish to at least GOSSIP_D peers
      floodPublish: !opts?.disableFloodPublish,
      // Only send IDONTWANT messages if the message size is larger than this
      // This should be large enough to not send IDONTWANT for "small" messages
      // See https://github.com/ChainSafe/lodestar/pull/7077#issuecomment-2383679472
      idontwantMinDataSize: 16829,
    });
    this.scoreParams = scoreParams;
    this.config = config;
    this.logger = logger;
    this.peersData = peersData;
    this.events = events;
    this.gossipTopicCache = gossipTopicCache;

    if (metricsRegister) {
      const metrics = createEth2GossipsubMetrics(metricsRegister);
      metrics.gossipMesh.peersByType.addCollect(() => this.onScrapeLodestarMetrics(metrics));
    }

    this.addEventListener("gossipsub:message", this.onGossipsubMessage.bind(this));
    this.events.on(NetworkEvent.gossipMessageValidationResult, this.onValidationResult.bind(this));
    this.events.on(NetworkEvent.blockProcessed, this.onBlockProcessed.bind(this));

    // Having access to this data is CRUCIAL for debugging. While this is a massive log, it must not be deleted.
    // Scoring issues require this dump + current peer score stats to re-calculate scores.
    if (!opts.skipParamsLog) {
      this.logger.debug("Gossipsub score params", {params: JSON.stringify(scoreParams)});
    }
  }

  /**
   * Subscribe to a `GossipTopic`
   */
  subscribeTopic(topic: GossipTopic): void {
    const topicStr = stringifyGossipTopic(this.config, topic);
    // Register known topicStr
    this.gossipTopicCache.setTopic(topicStr, topic);

    this.logger.verbose("Subscribe to gossipsub topic", {topic: topicStr});
    this.subscribe(topicStr);
  }

  /**
   * Unsubscribe to a `GossipTopic`
   */
  unsubscribeTopic(topic: GossipTopic): void {
    const topicStr = stringifyGossipTopic(this.config, topic);
    this.logger.verbose("Unsubscribe to gossipsub topic", {topic: topicStr});
    this.unsubscribe(topicStr);
  }

  private onScrapeLodestarMetrics(metrics: Eth2GossipsubMetrics): void {
    const mesh = this.mesh;
    // biome-ignore lint/complexity/useLiteralKeys: `topics` is a private attribute
    const topics = this["topics"] as Map<string, Set<string>>;
    const peers = this.peers;
    const score = this.score;
    const meshPeersByClient = new Map<string, number>();
    const meshPeerIdStrs = new Set<string>();

    for (const {peersMap, metricsGossip, type} of [
      {peersMap: mesh, metricsGossip: metrics.gossipMesh, type: "mesh"},
      {peersMap: topics, metricsGossip: metrics.gossipTopic, type: "topics"},
    ]) {
      // Pre-aggregate results by fork so we can fill the remaining metrics with 0
      const peersByTypeByFork = new Map2d<ForkName, GossipType, number>();
      const peersByBeaconAttSubnetByFork = new Map2dArr<ForkName, number>();
      const peersByBeaconSyncSubnetByFork = new Map2dArr<ForkName, number>();

      // loop through all mesh entries, count each set size
      for (const [topicString, peers] of peersMap) {
        // Ignore topics with 0 peers. May prevent overriding after a fork
        if (peers.size === 0) continue;

        // there are some new topics in the network so `getKnownTopic()` returns undefined
        // for example in prater: /eth2/82f4a72b/optimistic_light_client_update_v0/ssz_snappy
        const topic = this.gossipTopicCache.getKnownTopic(topicString);
        if (topic !== undefined) {
          if (topic.type === GossipType.beacon_attestation) {
            peersByBeaconAttSubnetByFork.set(topic.fork, topic.subnet, peers.size);
          } else if (topic.type === GossipType.sync_committee) {
            peersByBeaconSyncSubnetByFork.set(topic.fork, topic.subnet, peers.size);
          } else {
            peersByTypeByFork.set(topic.fork, topic.type, peers.size);
          }
        }

        if (type === "mesh") {
          for (const peer of peers) {
            if (!meshPeerIdStrs.has(peer)) {
              meshPeerIdStrs.add(peer);
              const client = this.peersData.connectedPeers.get(peer)?.agentClient?.toString() ?? ClientKind.Unknown;
              meshPeersByClient.set(client, (meshPeersByClient.get(client) ?? 0) + 1);
            }
          }
        }
      }

      // beacon attestation mesh gets counted separately so we can track mesh peers by subnet
      // zero out all gossip type & subnet choices, so the dashboard will register them
      for (const [fork, peersByType] of peersByTypeByFork.map) {
        for (const type of Object.values(GossipType)) {
          metricsGossip.peersByType.set({fork, type}, peersByType.get(type) ?? 0);
        }
      }
      for (const [fork, peersByBeaconAttSubnet] of peersByBeaconAttSubnetByFork.map) {
        for (let subnet = 0; subnet < ATTESTATION_SUBNET_COUNT; subnet++) {
          metricsGossip.peersByBeaconAttestationSubnet.set(
            {fork, subnet: attSubnetLabel(subnet)},
            peersByBeaconAttSubnet[subnet] ?? 0
          );
        }
      }
      for (const [fork, peersByBeaconSyncSubnet] of peersByBeaconSyncSubnetByFork.map) {
        for (let subnet = 0; subnet < SYNC_COMMITTEE_SUBNET_COUNT; subnet++) {
          // SYNC_COMMITTEE_SUBNET_COUNT is < 9, no need to prepend a 0 to the label
          metricsGossip.peersBySyncCommitteeSubnet.set({fork, subnet}, peersByBeaconSyncSubnet[subnet] ?? 0);
        }
      }
    }

    for (const [client, peers] of meshPeersByClient.entries()) {
      metrics.gossipPeer.meshPeersByClient.set({client}, peers);
    }

    // track gossip peer score
    let peerCountScoreGraylist = 0;
    let peerCountScorePublish = 0;
    let peerCountScoreGossip = 0;
    let peerCountScoreMesh = 0;
    const {graylistThreshold, publishThreshold, gossipThreshold} = gossipScoreThresholds;
    const gossipScores: number[] = [];

    for (const peerIdStr of peers.keys()) {
      const s = score.score(peerIdStr);
      if (s >= graylistThreshold) peerCountScoreGraylist++;
      if (s >= publishThreshold) peerCountScorePublish++;
      if (s >= gossipThreshold) peerCountScoreGossip++;
      if (s >= 0) peerCountScoreMesh++;
      gossipScores.push(s);
    }

    // Access once for all calls below
    metrics.gossipPeer.scoreByThreshold.set({threshold: "graylist"}, peerCountScoreGraylist);
    metrics.gossipPeer.scoreByThreshold.set({threshold: "publish"}, peerCountScorePublish);
    metrics.gossipPeer.scoreByThreshold.set({threshold: "gossip"}, peerCountScoreGossip);
    metrics.gossipPeer.scoreByThreshold.set({threshold: "mesh"}, peerCountScoreMesh);

    // Register full score too
    metrics.gossipPeer.score.set(gossipScores);
  }

  private onGossipsubMessage(event: GossipsubEvents["gossipsub:message"]): void {
    const {propagationSource, msgId, msg} = event.detail;

    // Also validates that the topicStr is known
    const topic = this.gossipTopicCache.getTopic(msg.topic);

    // Get seenTimestamp before adding the message to the queue or add async delays
    const seenTimestampSec = Date.now() / 1000;

    // Use setTimeout to yield to the macro queue
    // Without this we'll have huge event loop lag
    // See https://github.com/ChainSafe/lodestar/issues/5604
    callInNextEventLoop(() => {
      this.events.emit(NetworkEvent.pendingGossipsubMessage, {
        topic,
        msg,
        msgId,
        // Hot path, use cached .toString() version
        propagationSource: propagationSource.toString(),
        seenTimestampSec,
        startProcessUnixSec: null,
      });
    });
  }

  private onValidationResult(data: NetworkEventData[NetworkEvent.gossipMessageValidationResult]): void {
    // Use setTimeout to yield to the macro queue
    // Without this we'll have huge event loop lag
    // See https://github.com/ChainSafe/lodestar/issues/5604
    callInNextEventLoop(() => {
      this.reportMessageValidationResult(data.msgId, data.propagationSource, data.acceptance);
    });
  }

  private onBlockProcessed(data: NetworkEventData[NetworkEvent.blockProcessed]): void {
  }

}

/**
 * Left pad subnets to two characters. Assumes ATTESTATION_SUBNET_COUNT < 99
 * Otherwise grafana sorts the mesh peers chart as: [1,11,12,13,...]
 */
function attSubnetLabel(subnet: number): string {
  if (subnet > 9) return String(subnet);

  return `0${subnet}`;
}

function getMetricsTopicStrToLabel(config: BeaconConfig, opts: {disableLightClientServer: boolean}): TopicStrToLabel {
  const metricsTopicStrToLabel = new Map<TopicStr, TopicLabel>();

  for (const {name: fork} of config.forksAscendingEpochOrder) {
    const topics = getCoreTopicsAtFork(fork, {
      subscribeAllSubnets: true,
      disableLightClientServer: opts.disableLightClientServer,
    });
    for (const topic of topics) {
      metricsTopicStrToLabel.set(stringifyGossipTopic(config, {...topic, fork}), topic.type);
    }
  }
  return metricsTopicStrToLabel;
}
