/* eslint-disable @typescript-eslint/naming-convention */
import Gossipsub from "libp2p-gossipsub";
import {ERR_TOPIC_VALIDATOR_IGNORE, ERR_TOPIC_VALIDATOR_REJECT} from "libp2p-gossipsub/src/constants";
import {InMessage} from "libp2p-interfaces/src/pubsub";
import Libp2p from "libp2p";
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
import {computeMsgId, encodeMessageData, UncompressCache} from "./encoding";
import {DEFAULT_ENCODING} from "./constants";
import {GossipValidationError} from "./errors";
import {GOSSIP_MAX_SIZE} from "../../constants";
import {createValidatorFnsByType} from "./validation";
import {Map2d, Map2dArr} from "../../util/map";
import pipe from "it-pipe";
import PeerStreams from "libp2p-interfaces/src/pubsub/peer-streams";
import BufferList from "bl";
// import {RPC} from "libp2p-interfaces/src/pubsub/message/rpc";
import {RPC} from "libp2p-gossipsub/src/message/rpc";
import {normalizeInRpcMessage} from "libp2p-interfaces/src/pubsub/utils";

import {
  computeGossipPeerScoreParams,
  gossipScoreThresholds,
  GOSSIP_D,
  GOSSIP_D_HIGH,
  GOSSIP_D_LOW,
} from "./scoringParameters";
import {Eth2Context} from "../../chain";
import {IPeerRpcScoreStore} from "../peers";
import {computeAllPeersScoreWeights} from "./scoreMetrics";

export interface IGossipsubModules {
  config: IBeaconConfig;
  libp2p: Libp2p;
  peerRpcScores: IPeerRpcScoreStore;
  logger: ILogger;
  metrics: IMetrics | null;
  signal: AbortSignal;
  eth2Context: Eth2Context;
  gossipHandlers: GossipHandlers;
}

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
 * See https://github.com/ethereum/eth2.0-specs/blob/dev/specs/phase0/p2p-interface.md#the-gossip-domain-gossipsub
 */
export class Eth2Gossipsub extends Gossipsub {
  readonly jobQueues: GossipJobQueues;
  private readonly config: IBeaconConfig;
  private readonly logger: ILogger;

  // Internal caches
  private readonly gossipTopicCache: GossipTopicCache;
  private readonly uncompressCache = new UncompressCache();
  private readonly msgIdCache = new WeakMap<InMessage, Uint8Array>();

  private readonly validatorFnsByType: ValidatorFnsByType;

  constructor(modules: IGossipsubModules) {
    // Gossipsub parameters defined here:
    // https://github.com/ethereum/eth2.0-specs/blob/dev/specs/phase0/p2p-interface.md#the-gossip-domain-gossipsub
    super(modules.libp2p, {
      gossipIncoming: true,
      globalSignaturePolicy: "StrictNoSign" as const,
      D: GOSSIP_D,
      Dlo: GOSSIP_D_LOW,
      Dhi: GOSSIP_D_HIGH,
      Dlazy: 6,
      scoreParams: computeGossipPeerScoreParams(modules),
      scoreThresholds: gossipScoreThresholds,
    });
    const {config, logger, metrics, signal, gossipHandlers} = modules;
    this.config = config;
    this.logger = logger;
    this.gossipTopicCache = new GossipTopicCache(config);

    // Note: We use the validator functions as handlers. No handler will be registered to gossipsub.
    // libp2p-js layer will emit the message to an EventEmitter that won't be listened by anyone.
    // TODO: Force to ensure there's a validatorFunction attached to every received topic.
    const {validatorFnsByType, jobQueues} = createValidatorFnsByType(gossipHandlers, {
      config,
      logger,
      peerRpcScores: modules.peerRpcScores,
      uncompressCache: this.uncompressCache,
      metrics,
      signal,
    });
    this.validatorFnsByType = validatorFnsByType;
    this.jobQueues = jobQueues;

    if (metrics) {
      metrics.gossipMesh.peersByType.addCollect(() => this.onScrapeMetrics(metrics));
    }
  }

  start(): void {
    super.start();
  }

  stop(): void {
    try {
      super.stop();
    } catch (error) {
      if ((error as GossipValidationError).code !== "ERR_HEARTBEAT_NO_RUNNING") {
        throw error;
      }
    }
  }

  /**
   * @override Use eth2 msg id and cache results to the msg
   */
  getMsgId(msg: InMessage): Uint8Array {
    let msgId = this.msgIdCache.get(msg);
    if (!msgId) {
      const topicStr = msg.topicIDs[0];
      const topic = this.gossipTopicCache.getTopic(topicStr);
      msgId = computeMsgId(topic, topicStr, msg.data, this.uncompressCache);
      this.msgIdCache.set(msg, msgId);
    }
    return msgId;
  }

  // Temporaly reverts https://github.com/libp2p/js-libp2p-interfaces/pull/103 while a proper fixed is done upstream
  // await-ing _processRpc causes messages to be processed 10-20 seconds latter than when received. This kills the node
  async _processMessages(
    idB58Str: string,
    stream: AsyncIterable<Uint8Array | BufferList>,
    peerStreams: PeerStreams
  ): Promise<void> {
    try {
      await pipe(stream, async (source) => {
        for await (const data of source) {
          const rpcBytes = data instanceof Uint8Array ? data : data.slice();
          const rpcMsg = this._decodeRpc(rpcBytes);

          this._processRpc(idB58Str, peerStreams, rpcMsg).catch((e) => {
            this.log("_processRpc error", (e as Error).stack);
          });
        }
      });
    } catch (err) {
      this._onPeerDisconnected(peerStreams.id, err as Error);
    }
  }

  // Temporaly reverts https://github.com/libp2p/js-libp2p-interfaces/pull/103 while a proper fixed is done upstream
  // await-ing _processRpc causes messages to be processed 10-20 seconds latter than when received. This kills the node
  async _processRpc(idB58Str: string, peerStreams: PeerStreams, rpc: RPC): Promise<boolean> {
    this.log("rpc from", idB58Str);
    const subs = rpc.subscriptions;
    const msgs = rpc.msgs;

    if (subs.length) {
      // update peer subscriptions
      subs.forEach((subOpt) => {
        this._processRpcSubOpt(idB58Str, subOpt);
      });
      this.emit("pubsub:subscription-change", peerStreams.id, subs);
    }

    if (!this._acceptFrom(idB58Str)) {
      this.log("received message from unacceptable peer %s", idB58Str);
      return false;
    }

    if (msgs.length) {
      await Promise.all(
        msgs.map(async (message) => {
          if (
            !(
              this.canRelayMessage ||
              (message.topicIDs && message.topicIDs.some((topic) => this.subscriptions.has(topic)))
            )
          ) {
            this.log("received message we didn't subscribe to. Dropping.");
            return;
          }
          const msg = normalizeInRpcMessage(message, idB58Str);
          await this._processRpcMessage(msg);
        })
      );
    }
    // not a direct implementation of js-libp2p-gossipsub, this is from gossipsub
    // https://github.com/ChainSafe/js-libp2p-gossipsub/blob/751ea73e9b7dc2287ca56786857d32ec2ce796b9/ts/index.ts#L366
    if (rpc.control) {
      super._processRpcControlMessage(idB58Str, rpc.control);
    }
    return true;
  }

  // // Snippet of _processRpcMessage from https://github.com/libp2p/js-libp2p-interfaces/blob/92245d66b0073f0a72fed9f7abcf4b533102f1fd/packages/interfaces/src/pubsub/index.js#L442
  // async _processRpcMessage(msg: InMessage): Promise<void> {
  //   try {
  //     await this.validate(msg);
  //   } catch (err) {
  //     this.log("Message is invalid, dropping it. %O", err);
  //     return;
  //   }
  // }

  /**
   * @override https://github.com/ChainSafe/js-libp2p-gossipsub/blob/3c3c46595f65823fcd7900ed716f43f76c6b355c/ts/index.ts#L436
   * @override https://github.com/libp2p/js-libp2p-interfaces/blob/ff3bd10704a4c166ce63135747e3736915b0be8d/src/pubsub/index.js#L513
   * Note: this does not call super. All logic is re-implemented below
   */
  async validate(message: InMessage): Promise<void> {
    try {
      // messages must have a single topicID
      const topicStr = Array.isArray(message.topicIDs) ? message.topicIDs[0] : undefined;

      // message sanity check
      if (!topicStr || message.topicIDs.length > 1) {
        throw new GossipValidationError(ERR_TOPIC_VALIDATOR_REJECT, "Not exactly one topicID");
      }
      if (message.data === undefined) {
        throw new GossipValidationError(ERR_TOPIC_VALIDATOR_REJECT, "No message.data");
      }
      if (message.data.length > GOSSIP_MAX_SIZE) {
        throw new GossipValidationError(ERR_TOPIC_VALIDATOR_REJECT, "message.data too big");
      }

      if (message.from || message.signature || message.key || message.seqno) {
        throw new GossipValidationError(ERR_TOPIC_VALIDATOR_REJECT, "StrictNoSigning invalid");
      }

      // We use 'StrictNoSign' policy, no need to validate message signature

      // Also validates that the topicStr is known
      const topic = this.gossipTopicCache.getTopic(topicStr);

      // Get seenTimestamp before adding the message to the queue or add async delays
      const seenTimestampSec = Date.now() / 1000;

      // No error here means that the incoming object is valid
      await this.validatorFnsByType[topic.type](topic, message, seenTimestampSec);
    } catch (e) {
      // JobQueue may throw non-typed errors
      const code = e instanceof GossipValidationError ? e.code : ERR_TOPIC_VALIDATOR_IGNORE;
      // async to compute msgId with sha256 from multiformats/hashes/sha2
      await this.score.rejectMessage(message, code);
      await this.gossipTracer.rejectMessage(message, code);
      throw e;
    }
  }

  /**
   * @override
   * See https://github.com/libp2p/js-libp2p-interfaces/blob/v0.5.2/src/pubsub/index.js#L428
   *
   * Our handlers are attached on the validator functions, so no need to emit the objects internally.
   */
  _emitMessage(): void {
    // Objects are handled in the validator functions, no need to do anything here
  }

  /**
   * @override
   * Differs from upstream `unsubscribe` by _always_ unsubscribing,
   * instead of unsubsribing only when no handlers are attached to the topic
   *
   * See https://github.com/libp2p/js-libp2p-interfaces/blob/v0.8.3/src/pubsub/index.js#L720
   */
  unsubscribe(topicStr: string): void {
    if (!this.started) {
      throw new Error("Pubsub is not started");
    }

    if (this.subscriptions.has(topicStr)) {
      this.subscriptions.delete(topicStr);
      this.peers.forEach((_, id) => this._sendSubscriptions(id, [topicStr], false));
    }
  }

  /**
   * Publish a `GossipObject` on a `GossipTopic`
   */
  async publishObject<K extends GossipType>(topic: GossipTopicMap[K], object: GossipTypeMap[K]): Promise<void> {
    const topicStr = this.getGossipTopicString(topic);
    this.logger.verbose("Publish to topic", {topic: topicStr});
    const sszType = getGossipSSZType(topic);
    const messageData = (sszType.serialize as (object: GossipTypeMap[GossipType]) => Uint8Array)(object);
    await this.publish(topicStr, encodeMessageData(topic.encoding ?? DEFAULT_ENCODING, messageData));
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

  async publishBeaconAggregateAndProof(aggregateAndProof: phase0.SignedAggregateAndProof): Promise<void> {
    const fork = this.config.getForkName(aggregateAndProof.message.aggregate.data.slot);
    await this.publishObject<GossipType.beacon_aggregate_and_proof>(
      {type: GossipType.beacon_aggregate_and_proof, fork},
      aggregateAndProof
    );
  }

  async publishBeaconAttestation(attestation: phase0.Attestation, subnet: number): Promise<void> {
    const fork = this.config.getForkName(attestation.data.slot);
    await this.publishObject<GossipType.beacon_attestation>(
      {type: GossipType.beacon_attestation, fork, subnet},
      attestation
    );
  }

  async publishVoluntaryExit(voluntaryExit: phase0.SignedVoluntaryExit): Promise<void> {
    const fork = this.config.getForkName(computeStartSlotAtEpoch(voluntaryExit.message.epoch));
    await this.publishObject<GossipType.voluntary_exit>({type: GossipType.voluntary_exit, fork}, voluntaryExit);
  }

  async publishProposerSlashing(proposerSlashing: phase0.ProposerSlashing): Promise<void> {
    const fork = this.config.getForkName(proposerSlashing.signedHeader1.message.slot);
    await this.publishObject<GossipType.proposer_slashing>(
      {type: GossipType.proposer_slashing, fork},
      proposerSlashing
    );
  }

  async publishAttesterSlashing(attesterSlashing: phase0.AttesterSlashing): Promise<void> {
    const fork = this.config.getForkName(attesterSlashing.attestation1.data.slot);
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

  private onScrapeMetrics(metrics: IMetrics): void {
    for (const {peersMap, metricsGossip} of [
      {peersMap: this.mesh, metricsGossip: metrics.gossipMesh},
      {peersMap: this.topics, metricsGossip: metrics.gossipTopic},
    ]) {
      // Pre-aggregate results by fork so we can fill the remaining metrics with 0
      const peersByTypeByFork = new Map2d<ForkName, GossipType, number>();
      const peersByBeaconAttSubnetByFork = new Map2dArr<ForkName, number>();
      const peersByBeaconSyncSubnetByFork = new Map2dArr<ForkName, number>();

      // loop through all mesh entries, count each set size
      for (const [topicString, peers] of peersMap) {
        // Ignore topics with 0 peers. May prevent overriding after a fork
        if (peers.size === 0) continue;

        const topic = this.gossipTopicCache.getTopic(topicString);
        if (topic.type === GossipType.beacon_attestation) {
          peersByBeaconAttSubnetByFork.set(topic.fork, topic.subnet, peers.size);
        } else if (topic.type === GossipType.sync_committee) {
          peersByBeaconSyncSubnetByFork.set(topic.fork, topic.subnet, peers.size);
        } else {
          peersByTypeByFork.set(topic.fork, topic.type, peers.size);
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

    // track gossip peer score
    let peerCountScoreGraylist = 0;
    let peerCountScorePublish = 0;
    let peerCountScoreGossip = 0;
    let peerCountScoreMesh = 0;
    const {graylistThreshold, publishThreshold, gossipThreshold} = gossipScoreThresholds;
    const gossipScores = [];

    for (const peerIdStr of this.peers.keys()) {
      const score = this.score.score(peerIdStr);
      if (score >= graylistThreshold) peerCountScoreGraylist++;
      if (score >= publishThreshold) peerCountScorePublish++;
      if (score >= gossipThreshold) peerCountScoreGossip++;
      if (score >= 0) peerCountScoreMesh++;
      gossipScores.push(score);
    }

    // Access once for all calls below
    const {scoreByThreshold, scoreWeights} = metrics.gossipPeer;
    scoreByThreshold.set({threshold: "graylist"}, peerCountScoreGraylist);
    scoreByThreshold.set({threshold: "publish"}, peerCountScorePublish);
    scoreByThreshold.set({threshold: "gossip"}, peerCountScoreGossip);
    scoreByThreshold.set({threshold: "mesh"}, peerCountScoreMesh);

    // Breakdown on each score weight
    const sw = computeAllPeersScoreWeights(
      this.peers.keys(),
      this.score.peerStats,
      this.score.params,
      this.score.peerIPs,
      this.gossipTopicCache
    );

    for (const [topic, wsTopic] of sw.byTopic) {
      scoreWeights.set({topic, p: "p1"}, wsTopic.p1w);
      scoreWeights.set({topic, p: "p2"}, wsTopic.p2w);
      scoreWeights.set({topic, p: "p3"}, wsTopic.p3w);
      scoreWeights.set({topic, p: "p3b"}, wsTopic.p3bw);
      scoreWeights.set({topic, p: "p4"}, wsTopic.p4w);
    }

    scoreWeights.set({p: "p5"}, sw.p5w);
    scoreWeights.set({p: "p6"}, sw.p6w);
    scoreWeights.set({p: "p7"}, sw.p7w);

    // Register full score too
    metrics.gossipPeer.score.set(sw.score);
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
