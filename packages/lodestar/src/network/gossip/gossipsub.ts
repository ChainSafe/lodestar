/* eslint-disable @typescript-eslint/naming-convention */
import Gossipsub from "libp2p-gossipsub";
import {ERR_TOPIC_VALIDATOR_IGNORE, ERR_TOPIC_VALIDATOR_REJECT} from "libp2p-gossipsub/src/constants";
import {InMessage} from "libp2p-interfaces/src/pubsub";
import Libp2p from "libp2p";
import {AbortSignal} from "@chainsafe/abort-controller";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {ATTESTATION_SUBNET_COUNT, ForkName, SYNC_COMMITTEE_SUBNET_COUNT} from "@chainsafe/lodestar-params";
import {allForks, altair, phase0} from "@chainsafe/lodestar-types";
import {ILogger} from "@chainsafe/lodestar-utils";
import {computeStartSlotAtEpoch} from "@chainsafe/lodestar-beacon-state-transition";

import {IMetrics} from "../../metrics";
import {GossipJobQueues, GossipTopic, GossipTopicMap, GossipType, GossipTypeMap, ValidatorFnsByType} from "./interface";
import {getGossipSSZType, GossipTopicCache, stringifyGossipTopic} from "./topic";
import {computeMsgId, encodeMessageData, UncompressCache} from "./encoding";
import {DEFAULT_ENCODING} from "./constants";
import {GossipValidationError} from "./errors";
import {IForkDigestContext} from "../../util/forkDigestContext";
import {GOSSIP_MAX_SIZE} from "../../constants";
import {createValidatorFnsByType} from "./validation";
import {GossipHandlers} from "./handlers";
import {Map2d, Map2dArr} from "../../util/map";

interface IGossipsubModules {
  config: IChainForkConfig;
  libp2p: Libp2p;
  logger: ILogger;
  metrics: IMetrics | null;
  signal: AbortSignal;
  forkDigestContext: IForkDigestContext;
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
  private readonly config: IChainForkConfig;
  private readonly forkDigestContext: IForkDigestContext;
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
      D: 8,
      Dlo: 6,
      Dhi: 12,
      Dlazy: 6,
    });
    const {config, forkDigestContext, logger, metrics, signal, gossipHandlers} = modules;
    this.config = config;
    this.forkDigestContext = forkDigestContext;
    this.logger = logger;
    this.gossipTopicCache = new GossipTopicCache(forkDigestContext);

    // Note: We use the validator functions as handlers. No handler will be registered to gossipsub.
    // libp2p-js layer will emit the message to an EventEmitter that won't be listened by anyone.
    // TODO: Force to ensure there's a validatorFunction attached to every received topic.
    const {validatorFnsByType, jobQueues} = createValidatorFnsByType(gossipHandlers, {
      config,
      logger,
      uncompressCache: this.uncompressCache,
      metrics,
      signal,
    });
    this.validatorFnsByType = validatorFnsByType;
    this.jobQueues = jobQueues;

    if (metrics) {
      metrics.gossipMeshPeersByType.addCollect(() => this.onScrapeMetrics(metrics));
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

  /**
   * @override https://github.com/ChainSafe/js-libp2p-gossipsub/blob/3c3c46595f65823fcd7900ed716f43f76c6b355c/ts/index.ts#L436
   * @override https://github.com/libp2p/js-libp2p-interfaces/blob/ff3bd10704a4c166ce63135747e3736915b0be8d/src/pubsub/index.js#L513
   * Note: this does not call super. All logic is re-implemented below
   */
  async validate(message: InMessage): Promise<void> {
    try {
      // messages must have a single topicID
      const topicStr = (message.topicIDs || [])[0];

      // message sanity check
      if (!topicStr || message.topicIDs.length > 1) {
        throw new GossipValidationError(ERR_TOPIC_VALIDATOR_REJECT, "Not exactly one topicID");
      }
      if (!message.data) {
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

      // No error here means that the incoming object is valid
      await this.validatorFnsByType[topic.type](topic, message);
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
    return stringifyGossipTopic(this.forkDigestContext, topic);
  }

  private onScrapeMetrics(metrics: IMetrics): void {
    // Pre-aggregate results by fork so we can fill the remaining metrics with 0
    const peersByTypeByFork = new Map2d<ForkName, GossipType, number>();
    const peersByBeaconAttSubnetByFork = new Map2dArr<ForkName, number>();
    const peersByBeaconSyncSubnetByFork = new Map2dArr<ForkName, number>();

    // loop through all mesh entries, count each set size
    for (const [topicString, peers] of this.mesh.entries()) {
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
    for (const [fork, peersByType] of peersByTypeByFork.map.entries()) {
      for (const type of Object.values(GossipType)) {
        metrics.gossipMeshPeersByType.set({fork, type}, peersByType.get(type) ?? 0);
      }
    }
    for (const [fork, peersByBeaconAttSubnet2] of peersByBeaconAttSubnetByFork.map.entries()) {
      for (let subnet = 0; subnet < ATTESTATION_SUBNET_COUNT; subnet++) {
        metrics.gossipMeshPeersByBeaconAttestationSubnet.set(
          {fork, subnet: attSubnetLabel(subnet)},
          peersByBeaconAttSubnet2[subnet] ?? 0
        );
      }
    }
    for (const [fork, peersByBeaconSyncSubnet2] of peersByBeaconSyncSubnetByFork.map.entries()) {
      for (let subnet = 0; subnet < SYNC_COMMITTEE_SUBNET_COUNT; subnet++) {
        // SYNC_COMMITTEE_SUBNET_COUNT is < 9, no need to prepend a 0 to the label
        metrics.gossipMeshPeersBySyncCommitteeSubnet.set({fork, subnet}, peersByBeaconSyncSubnet2[subnet] ?? 0);
      }
    }
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
