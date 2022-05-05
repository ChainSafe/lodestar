/* eslint-disable @typescript-eslint/naming-convention */
import Libp2p from "libp2p";
import Gossipsub from "libp2p-gossipsub";
import {GossipsubMessage, SignaturePolicy, TopicStr} from "libp2p-gossipsub/src/types";
import {PeerScore, PeerScoreParams} from "libp2p-gossipsub/src/score";
import PeerId from "peer-id";
import {AbortSignal} from "@chainsafe/abort-controller";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ATTESTATION_SUBNET_COUNT, ForkName, SYNC_COMMITTEE_SUBNET_COUNT} from "@chainsafe/lodestar-params";
import {allForks, altair, phase0} from "@chainsafe/lodestar-types";
import {ILogger} from "@chainsafe/lodestar-utils";
import {computeStartSlotAtEpoch} from "@chainsafe/lodestar-beacon-state-transition";

import {IMetrics} from "../../metrics";
import {
  GossipJobQueues,
  GossipTopic,
  GossipTopicMap,
  GossipType,
  GossipTypeMap,
  ValidatorFnsByType,
  GossipHandlers,
} from "./interface";
import {getGossipSSZType, GossipTopicCache, stringifyGossipTopic} from "./topic";
import {DataTransformSnappy, fastMsgIdFn, msgIdFn} from "./encoding";
import {createValidatorFnsByType} from "./validation";
import {Map2d, Map2dArr} from "../../util/map";

import {
  computeGossipPeerScoreParams,
  gossipScoreThresholds,
  GOSSIP_D,
  GOSSIP_D_HIGH,
  GOSSIP_D_LOW,
} from "./scoringParameters";
import {Eth2Context} from "../../chain";
import {MetricsRegister, TopicLabel, TopicStrToLabel} from "libp2p-gossipsub/src/metrics";
import {PeersData} from "../peers/peersData";
import {ClientKind} from "../peers/client";

/* eslint-disable @typescript-eslint/naming-convention */

// TODO: Export this type
type GossipsubEvents = {
  "gossipsub:message": {
    propagationSource: PeerId;
    msgId: string;
    msg: GossipsubMessage;
  };
};

export type Eth2GossipsubModules = {
  config: IBeaconConfig;
  libp2p: Libp2p;
  logger: ILogger;
  metrics: IMetrics | null;
  signal: AbortSignal;
  eth2Context: Eth2Context;
  gossipHandlers: GossipHandlers;
  peersData: PeersData;
};

export type Eth2GossipsubOpts = {
  allowPublishToZeroPeers?: boolean;
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
export class Eth2Gossipsub extends Gossipsub {
  readonly jobQueues: GossipJobQueues;
  readonly scoreParams: Partial<PeerScoreParams>;
  private readonly config: IBeaconConfig;
  private readonly logger: ILogger;
  private readonly peersData: PeersData;

  // Internal caches
  private readonly gossipTopicCache: GossipTopicCache;

  private readonly validatorFnsByType: ValidatorFnsByType;

  constructor(opts: Eth2GossipsubOpts, modules: Eth2GossipsubModules) {
    const gossipTopicCache = new GossipTopicCache(modules.config);

    const scoreParams = computeGossipPeerScoreParams(modules);

    // Gossipsub parameters defined here:
    // https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/phase0/p2p-interface.md#the-gossip-domain-gossipsub
    super(modules.libp2p, {
      gossipIncoming: true,
      globalSignaturePolicy: SignaturePolicy.StrictNoSign,
      allowPublishToZeroPeers: opts.allowPublishToZeroPeers,
      D: GOSSIP_D,
      Dlo: GOSSIP_D_LOW,
      Dhi: GOSSIP_D_HIGH,
      Dlazy: 6,
      scoreParams,
      scoreThresholds: gossipScoreThresholds,
      // the default in gossipsub is 3s is not enough since lodestar suffers from I/O lag
      gossipsubIWantFollowupMs: 12 * 1000, // 12s
      fastMsgIdFn: fastMsgIdFn,
      msgIdFn: msgIdFn.bind(msgIdFn, gossipTopicCache),
      dataTransform: new DataTransformSnappy(gossipTopicCache),
      metricsRegister: modules.metrics ? ((modules.metrics.register as unknown) as MetricsRegister) : null,
      metricsTopicStrToLabel: modules.metrics ? getMetricsTopicStrToLabel(modules.config) : undefined,
      asyncValidation: true,
    });
    this.scoreParams = scoreParams;
    const {config, logger, metrics, signal, gossipHandlers, peersData} = modules;
    this.config = config;
    this.logger = logger;
    this.peersData = peersData;
    this.gossipTopicCache = gossipTopicCache;

    // Note: We use the validator functions as handlers. No handler will be registered to gossipsub.
    // libp2p-js layer will emit the message to an EventEmitter that won't be listened by anyone.
    // TODO: Force to ensure there's a validatorFunction attached to every received topic.
    const {validatorFnsByType, jobQueues} = createValidatorFnsByType(gossipHandlers, {
      config,
      logger,
      metrics,
      signal,
    });
    this.validatorFnsByType = validatorFnsByType;
    this.jobQueues = jobQueues;

    if (metrics) {
      metrics.gossipMesh.peersByType.addCollect(() => this.onScrapeLodestarMetrics(metrics));
    }

    this.on("gossipsub:message", this.onGossipsubMessage.bind(this));

    // Having access to this data is CRUCIAL for debugging. While this is a massive log, it must not be deleted.
    // Scoring issues require this dump + current peer score stats to re-calculate scores.
    this.logger.debug("Gossipsub score params", {params: JSON.stringify(scoreParams)});
  }

  /**
   * Publish a `GossipObject` on a `GossipTopic`
   */
  async publishObject<K extends GossipType>(topic: GossipTopicMap[K], object: GossipTypeMap[K]): Promise<number> {
    const topicStr = this.getGossipTopicString(topic);
    const sszType = getGossipSSZType(topic);
    const messageData = (sszType.serialize as (object: GossipTypeMap[GossipType]) => Uint8Array)(object);
    const sentPeers = await this.publish(topicStr, messageData);
    this.logger.verbose("Publish to topic", {topic: topicStr, sentPeers});
    return sentPeers;
  }

  /**
   * Subscribe to a `GossipTopic`
   */
  subscribeTopic(topic: GossipTopic): void {
    const topicStr = this.getGossipTopicString(topic);
    // Register known topicStr
    this.gossipTopicCache.setTopic(topicStr, topic);

    this.logger.verbose("Subscribe to gossipsub topic", {topic: topicStr});
    this.subscribe(topicStr);
  }

  /**
   * Unsubscribe to a `GossipTopic`
   */
  unsubscribeTopic(topic: GossipTopic): void {
    const topicStr = this.getGossipTopicString(topic);
    this.logger.verbose("Unsubscribe to gossipsub topic", {topic: topicStr});
    this.unsubscribe(topicStr);
  }

  async publishBeaconBlock(signedBlock: allForks.SignedBeaconBlock): Promise<void> {
    const fork = this.config.getForkName(signedBlock.message.slot);
    await this.publishObject<GossipType.beacon_block>({type: GossipType.beacon_block, fork}, signedBlock);
  }

  async publishBeaconAggregateAndProof(aggregateAndProof: phase0.SignedAggregateAndProof): Promise<number> {
    const fork = this.config.getForkName(aggregateAndProof.message.aggregate.data.slot);
    return await this.publishObject<GossipType.beacon_aggregate_and_proof>(
      {type: GossipType.beacon_aggregate_and_proof, fork},
      aggregateAndProof
    );
  }

  async publishBeaconAttestation(attestation: phase0.Attestation, subnet: number): Promise<number> {
    const fork = this.config.getForkName(attestation.data.slot);
    return await this.publishObject<GossipType.beacon_attestation>(
      {type: GossipType.beacon_attestation, fork, subnet},
      attestation
    );
  }

  async publishVoluntaryExit(voluntaryExit: phase0.SignedVoluntaryExit): Promise<void> {
    const fork = this.config.getForkName(computeStartSlotAtEpoch(voluntaryExit.message.epoch));
    await this.publishObject<GossipType.voluntary_exit>({type: GossipType.voluntary_exit, fork}, voluntaryExit);
  }

  async publishProposerSlashing(proposerSlashing: phase0.ProposerSlashing): Promise<void> {
    const fork = this.config.getForkName(Number(proposerSlashing.signedHeader1.message.slot as bigint));
    await this.publishObject<GossipType.proposer_slashing>(
      {type: GossipType.proposer_slashing, fork},
      proposerSlashing
    );
  }

  async publishAttesterSlashing(attesterSlashing: phase0.AttesterSlashing): Promise<void> {
    const fork = this.config.getForkName(Number(attesterSlashing.attestation1.data.slot as bigint));
    await this.publishObject<GossipType.attester_slashing>(
      {type: GossipType.attester_slashing, fork},
      attesterSlashing
    );
  }

  async publishSyncCommitteeSignature(signature: altair.SyncCommitteeMessage, subnet: number): Promise<void> {
    const fork = this.config.getForkName(signature.slot);
    await this.publishObject<GossipType.sync_committee>({type: GossipType.sync_committee, fork, subnet}, signature);
  }

  async publishContributionAndProof(contributionAndProof: altair.SignedContributionAndProof): Promise<void> {
    const fork = this.config.getForkName(contributionAndProof.message.contribution.slot);
    await this.publishObject<GossipType.sync_committee_contribution_and_proof>(
      {type: GossipType.sync_committee_contribution_and_proof, fork},
      contributionAndProof
    );
  }

  private getGossipTopicString(topic: GossipTopic): string {
    return stringifyGossipTopic(this.config, topic);
  }

  private onScrapeLodestarMetrics(metrics: IMetrics): void {
    const mesh = this["mesh"] as Map<string, Set<string>>;
    const topics = this["topics"] as Map<string, Set<string>>;
    const peers = this["peers"] as Map<string, unknown>;
    const score = this["score"] as PeerScore;
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
              const client =
                this.peersData.connectedPeers.get(peer)?.agentClient?.toString() ?? ClientKind.Unknown.toString();
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
    const {propagationSource, msgId, msg} = event;

    // TODO: validation GOSSIP_MAX_SIZE
    // - Should be done here after inserting the message in the mcache?
    // - Should be done in the inboundtransform?
    // - Should be a parameter in gossipsub: maxMsgDataSize?

    // Also validates that the topicStr is known
    const topic = this.gossipTopicCache.getTopic(msg.topic);

    // Get seenTimestamp before adding the message to the queue or add async delays
    const seenTimestampSec = Date.now() / 1000;

    // Puts object in queue, validates, then processes
    this.validatorFnsByType[topic.type](topic, msg, propagationSource.toString(), seenTimestampSec)
      .then((acceptance) => {
        this.reportMessageValidationResult(msgId, propagationSource, acceptance);
      })
      .catch((e) => {
        this.logger.error("Error onGossipsubMessage", {}, e);
      });
  }
}

/**
 * Left pad subnets to two characters. Assumes ATTESTATION_SUBNET_COUNT < 99
 * Otherwise grafana sorts the mesh peers chart as: [1,11,12,13,...]
 */
function attSubnetLabel(subnet: number): string {
  if (subnet > 9) return String(subnet);
  else return `0${subnet}`;
}

function getMetricsTopicStrToLabel(config: IBeaconConfig): TopicStrToLabel {
  const metricsTopicStrToLabel = new Map<TopicStr, TopicLabel>();
  const topics: GossipTopic[] = [];

  for (const {name: fork} of config.forksAscendingEpochOrder) {
    for (let subnet = 0; subnet < ATTESTATION_SUBNET_COUNT; subnet++) {
      topics.push({fork, type: GossipType.beacon_attestation, subnet});
    }

    for (let subnet = 0; subnet < SYNC_COMMITTEE_SUBNET_COUNT; subnet++) {
      topics.push({fork, type: GossipType.sync_committee, subnet});
    }

    topics.push({fork, type: GossipType.beacon_block});
    topics.push({fork, type: GossipType.beacon_aggregate_and_proof});
    topics.push({fork, type: GossipType.voluntary_exit});
    topics.push({fork, type: GossipType.proposer_slashing});
    topics.push({fork, type: GossipType.attester_slashing});
    topics.push({fork, type: GossipType.sync_committee_contribution_and_proof});
  }

  for (const topic of topics) {
    metricsTopicStrToLabel.set(stringifyGossipTopic(config, topic), topic.type);
  }

  return metricsTopicStrToLabel;
}
