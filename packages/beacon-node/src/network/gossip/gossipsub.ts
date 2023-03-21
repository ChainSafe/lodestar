import {GossipSub, GossipsubEvents} from "@chainsafe/libp2p-gossipsub";
import {PublishOpts, SignaturePolicy, TopicStr} from "@chainsafe/libp2p-gossipsub/types";
import {PeerScore, PeerScoreParams} from "@chainsafe/libp2p-gossipsub/score";
import {MetricsRegister, TopicLabel, TopicStrToLabel} from "@chainsafe/libp2p-gossipsub/metrics";
import {BeaconConfig} from "@lodestar/config";
import {ATTESTATION_SUBNET_COUNT, ForkName, SYNC_COMMITTEE_SUBNET_COUNT} from "@lodestar/params";
import {allForks, altair, phase0, capella, deneb} from "@lodestar/types";
import {Logger, Map2d, Map2dArr} from "@lodestar/utils";
import {computeStartSlotAtEpoch} from "@lodestar/state-transition";

import {Metrics} from "../../metrics/index.js";
import {Eth2Context} from "../../chain/index.js";
import {PeersData} from "../peers/peersData.js";
import {ClientKind} from "../peers/client.js";
import {GOSSIP_MAX_SIZE, GOSSIP_MAX_SIZE_BELLATRIX} from "../../constants/network.js";
import {Libp2p} from "../interface.js";
import {
  GossipJobQueues,
  GossipTopic,
  GossipTopicMap,
  GossipType,
  GossipTypeMap,
  ValidatorFnsByType,
  GossipHandlers,
  GossipBeaconNode,
} from "./interface.js";
import {getGossipSSZType, GossipTopicCache, stringifyGossipTopic, getCoreTopicsAtFork} from "./topic.js";
import {DataTransformSnappy, fastMsgIdFn, msgIdFn, msgIdToStrFn} from "./encoding.js";
import {createValidatorFnsByType} from "./validation/index.js";

import {
  computeGossipPeerScoreParams,
  gossipScoreThresholds,
  GOSSIP_D,
  GOSSIP_D_HIGH,
  GOSSIP_D_LOW,
} from "./scoringParameters.js";

/* eslint-disable @typescript-eslint/naming-convention */
/** As specified in https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/phase0/p2p-interface.md */
const GOSSIPSUB_HEARTBEAT_INTERVAL = 0.7 * 1000;

const MAX_OUTBOUND_BUFFER_SIZE = 2 ** 24; // 16MB

export type Eth2GossipsubModules = {
  config: BeaconConfig;
  libp2p: Libp2p;
  logger: Logger;
  metrics: Metrics | null;
  signal: AbortSignal;
  eth2Context: Eth2Context;
  gossipHandlers: GossipHandlers;
  peersData: PeersData;
};

export type Eth2GossipsubOpts = {
  allowPublishToZeroPeers?: boolean;
  gossipsubD?: number;
  gossipsubDLow?: number;
  gossipsubDHigh?: number;
  gossipsubAwaitHandler?: boolean;
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
export class Eth2Gossipsub extends GossipSub implements GossipBeaconNode {
  readonly jobQueues: GossipJobQueues;
  readonly scoreParams: Partial<PeerScoreParams>;
  private readonly config: BeaconConfig;
  private readonly logger: Logger;
  private readonly peersData: PeersData;

  // Internal caches
  private readonly gossipTopicCache: GossipTopicCache;

  private readonly validatorFnsByType: ValidatorFnsByType;

  constructor(opts: Eth2GossipsubOpts, modules: Eth2GossipsubModules) {
    const {allowPublishToZeroPeers, gossipsubD, gossipsubDLow, gossipsubDHigh} = opts;
    const gossipTopicCache = new GossipTopicCache(modules.config);

    const scoreParams = computeGossipPeerScoreParams(modules);
    const {config, logger, metrics, signal, gossipHandlers, peersData} = modules;

    // Gossipsub parameters defined here:
    // https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/phase0/p2p-interface.md#the-gossip-domain-gossipsub
    super(modules.libp2p, {
      globalSignaturePolicy: SignaturePolicy.StrictNoSign,
      allowPublishToZeroPeers: allowPublishToZeroPeers,
      D: gossipsubD ?? GOSSIP_D,
      Dlo: gossipsubDLow ?? GOSSIP_D_LOW,
      Dhi: gossipsubDHigh ?? GOSSIP_D_HIGH,
      Dlazy: 6,
      heartbeatInterval: GOSSIPSUB_HEARTBEAT_INTERVAL,
      fanoutTTL: 60 * 1000,
      mcacheLength: 6,
      mcacheGossip: 3,
      seenTTL: 550 * GOSSIPSUB_HEARTBEAT_INTERVAL,
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
        isFinite(config.BELLATRIX_FORK_EPOCH) ? GOSSIP_MAX_SIZE_BELLATRIX : GOSSIP_MAX_SIZE
      ),
      metricsRegister: modules.metrics ? ((modules.metrics.register as unknown) as MetricsRegister) : null,
      metricsTopicStrToLabel: modules.metrics ? getMetricsTopicStrToLabel(modules.config) : undefined,
      asyncValidation: true,

      maxOutboundBufferSize: MAX_OUTBOUND_BUFFER_SIZE,
    });
    this.scoreParams = scoreParams;
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

    this.addEventListener("gossipsub:message", this.onGossipsubMessage.bind(this));

    // Having access to this data is CRUCIAL for debugging. While this is a massive log, it must not be deleted.
    // Scoring issues require this dump + current peer score stats to re-calculate scores.
    this.logger.debug("Gossipsub score params", {params: JSON.stringify(scoreParams)});
  }

  /**
   * Publish a `GossipObject` on a `GossipTopic`
   */
  async publishObject<K extends GossipType>(
    topic: GossipTopicMap[K],
    object: GossipTypeMap[K],
    opts?: PublishOpts | undefined
  ): Promise<number> {
    const topicStr = this.getGossipTopicString(topic);
    const sszType = getGossipSSZType(topic);
    const messageData = (sszType.serialize as (object: GossipTypeMap[GossipType]) => Uint8Array)(object);
    const result = await this.publish(topicStr, messageData, opts);
    const sentPeers = result.recipients.length;
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
    await this.publishObject<GossipType.beacon_block>({type: GossipType.beacon_block, fork}, signedBlock, {
      ignoreDuplicatePublishError: true,
    });
  }

  async publishSignedBeaconBlockAndBlobsSidecar(item: deneb.SignedBeaconBlockAndBlobsSidecar): Promise<void> {
    const fork = this.config.getForkName(item.beaconBlock.message.slot);
    await this.publishObject<GossipType.beacon_block_and_blobs_sidecar>(
      {type: GossipType.beacon_block_and_blobs_sidecar, fork},
      item,
      {ignoreDuplicatePublishError: true}
    );
  }

  async publishBeaconAggregateAndProof(aggregateAndProof: phase0.SignedAggregateAndProof): Promise<number> {
    const fork = this.config.getForkName(aggregateAndProof.message.aggregate.data.slot);
    return this.publishObject<GossipType.beacon_aggregate_and_proof>(
      {type: GossipType.beacon_aggregate_and_proof, fork},
      aggregateAndProof,
      {ignoreDuplicatePublishError: true}
    );
  }

  async publishBeaconAttestation(attestation: phase0.Attestation, subnet: number): Promise<number> {
    const fork = this.config.getForkName(attestation.data.slot);
    return this.publishObject<GossipType.beacon_attestation>(
      {type: GossipType.beacon_attestation, fork, subnet},
      attestation,
      {ignoreDuplicatePublishError: true}
    );
  }

  async publishVoluntaryExit(voluntaryExit: phase0.SignedVoluntaryExit): Promise<void> {
    const fork = this.config.getForkName(computeStartSlotAtEpoch(voluntaryExit.message.epoch));
    await this.publishObject<GossipType.voluntary_exit>({type: GossipType.voluntary_exit, fork}, voluntaryExit, {
      ignoreDuplicatePublishError: true,
    });
  }

  async publishBlsToExecutionChange(blsToExecutionChange: capella.SignedBLSToExecutionChange): Promise<void> {
    const fork = ForkName.capella;
    await this.publishObject<GossipType.bls_to_execution_change>(
      {type: GossipType.bls_to_execution_change, fork},
      blsToExecutionChange,
      {ignoreDuplicatePublishError: true}
    );
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
    await this.publishObject<GossipType.sync_committee>({type: GossipType.sync_committee, fork, subnet}, signature, {
      ignoreDuplicatePublishError: true,
    });
  }

  async publishContributionAndProof(contributionAndProof: altair.SignedContributionAndProof): Promise<void> {
    const fork = this.config.getForkName(contributionAndProof.message.contribution.slot);
    await this.publishObject<GossipType.sync_committee_contribution_and_proof>(
      {type: GossipType.sync_committee_contribution_and_proof, fork},
      contributionAndProof,
      {ignoreDuplicatePublishError: true}
    );
  }

  async publishLightClientFinalityUpdate(lightClientFinalityUpdate: allForks.LightClientFinalityUpdate): Promise<void> {
    const fork = this.config.getForkName(lightClientFinalityUpdate.signatureSlot);
    await this.publishObject<GossipType.light_client_finality_update>(
      {type: GossipType.light_client_finality_update, fork},
      lightClientFinalityUpdate
    );
  }

  async publishLightClientOptimisticUpdate(
    lightClientOptimisitcUpdate: allForks.LightClientOptimisticUpdate
  ): Promise<void> {
    const fork = this.config.getForkName(lightClientOptimisitcUpdate.signatureSlot);
    await this.publishObject<GossipType.light_client_optimistic_update>(
      {type: GossipType.light_client_optimistic_update, fork},
      lightClientOptimisitcUpdate
    );
  }

  private getGossipTopicString(topic: GossipTopic): string {
    return stringifyGossipTopic(this.config, topic);
  }

  private onScrapeLodestarMetrics(metrics: Metrics): void {
    const mesh = this["mesh"] as Map<string, Set<string>>;
    const topics = this["topics"] as Map<string, Set<string>>;
    const peers = this["peers"] as Set<string>;
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
    const {propagationSource, msgId, msg} = event.detail;

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

function getMetricsTopicStrToLabel(config: BeaconConfig): TopicStrToLabel {
  const metricsTopicStrToLabel = new Map<TopicStr, TopicLabel>();

  for (const {name: fork} of config.forksAscendingEpochOrder) {
    const topics = getCoreTopicsAtFork(fork, {subscribeAllSubnets: true});
    for (const topic of topics) {
      metricsTopicStrToLabel.set(stringifyGossipTopic(config, {...topic, fork}), topic.type);
    }
  }
  return metricsTopicStrToLabel;
}
