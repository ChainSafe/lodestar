/* eslint-disable @typescript-eslint/naming-convention */
import Gossipsub from "libp2p-gossipsub";
import {InMessage} from "libp2p-interfaces/src/pubsub";
import Libp2p from "libp2p";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ATTESTATION_SUBNET_COUNT} from "@chainsafe/lodestar-params";
import {allForks, altair, phase0} from "@chainsafe/lodestar-types";
import {ILogger, toJson} from "@chainsafe/lodestar-utils";
import {computeEpochAtSlot} from "@chainsafe/lodestar-beacon-state-transition";

import {IMetrics} from "../../metrics";
import {GossipHandlerFn, GossipObject, GossipTopic, GossipType, IGossipMessage, TopicValidatorFnMap} from "./interface";
import {msgIdToString, getMsgId, messageIsValid} from "./utils";
import {getGossipSSZSerializer, parseGossipTopic, stringifyGossipTopic} from "./topic";
import {encodeMessageData} from "./encoding";
import {DEFAULT_ENCODING} from "./constants";
import {GossipValidationError} from "./errors";
import {ERR_TOPIC_VALIDATOR_REJECT} from "libp2p-gossipsub/src/constants";
import {prepareGossipMsg} from "./message";
import {IForkDigestContext} from "../../util/forkDigestContext";

interface IGossipsubModules {
  config: IBeaconConfig;
  libp2p: Libp2p;
  validatorFns: TopicValidatorFnMap;
  forkDigestContext: IForkDigestContext;
  logger: ILogger;
  metrics: IMetrics | null;
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
  private readonly config: IBeaconConfig;
  private readonly forkDigestContext: IForkDigestContext;
  private readonly logger: ILogger;
  private readonly metrics: IMetrics | null;
  /**
   * Cached gossip objects
   *
   * Objects are deserialized during validation. If they pass validation, they get added here for later processing
   */
  private gossipObjects: Map<string, GossipObject>;
  /**
   * Cached gossip topic objects
   */
  private gossipTopics: Map<string, GossipTopic>;
  /**
   * Timeout for logging status message
   */
  private statusInterval?: NodeJS.Timeout;

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
    this.config = modules.config;
    this.forkDigestContext = modules.forkDigestContext;
    this.logger = modules.logger;
    this.metrics = modules.metrics;

    this.gossipObjects = new Map<string, GossipObject>();
    this.gossipTopics = new Map<string, GossipTopic>();

    for (const [topic, validatorFn] of modules.validatorFns.entries()) {
      this.topicValidators.set(topic, validatorFn);
    }
  }

  start(): void {
    super.start();
    this.statusInterval = setInterval(this.logSubscriptions, 12000);
  }

  stop(): void {
    try {
      super.stop();
      if (this.statusInterval) {
        clearInterval(this.statusInterval);
      }
    } catch (error) {
      if ((error as GossipValidationError).code !== "ERR_HEARTBEAT_NO_RUNNING") {
        throw error;
      }
    }
  }

  /**
   * @override Use eth2 msg id and cache results to the msg
   */
  getMsgId(msg: IGossipMessage): Uint8Array {
    return getMsgId(msg);
  }

  /**
   * @override
   */
  async validate(message: IGossipMessage): Promise<void> {
    try {
      // message sanity check
      if (!messageIsValid(message)) {
        throw null;
      }
      // get GossipTopic and GossipObject, set on IGossipMessage
      const gossipTopic = this.getGossipTopic(message.topicIDs[0]);
      prepareGossipMsg(message, gossipTopic, this.config);
    } catch (e) {
      const err = new GossipValidationError(ERR_TOPIC_VALIDATOR_REJECT);
      // must set gossip scores manually, since this usually happens in super.validate
      this.score.rejectMessage(message, err.code);
      this.gossipTracer.rejectMessage(message, err.code);
      throw e;
    }

    await super.validate(message); // No error here means that the incoming object is valid

    //`message.gossipObject` must have been set ^ so that we can cache the deserialized gossip object
    if (message.gossipObject) {
      this.gossipObjects.set(msgIdToString(this.getMsgId(message)), message.gossipObject);
    }
  }

  /**
   * @override
   * See https://github.com/libp2p/js-libp2p-interfaces/blob/v0.5.2/src/pubsub/index.js#L428
   *
   * Instead of emitting `InMessage`, emit `GossipObject`
   */
  _emitMessage(message: InMessage): void {
    const topic = message.topicIDs[0];
    const msgIdStr = msgIdToString(this.getMsgId(message));
    const gossipObject = this.gossipObjects.get(msgIdStr);
    if (gossipObject) {
      this.gossipObjects.delete(msgIdStr);
    }
    // Only messages that are currently subscribed and have properly been cached are emitted
    if (this.subscriptions.has(topic) && gossipObject) {
      this.emit(topic, gossipObject);
    }
  }

  /**
   * @override
   * Differs from upstream `unsubscribe` by _always_ unsubscribing,
   * instead of unsubsribing only when no handlers are attached to the topic
   *
   * See https://github.com/libp2p/js-libp2p-interfaces/blob/v0.8.3/src/pubsub/index.js#L720
   */
  unsubscribe(topic: string): void {
    if (!this.started) {
      throw new Error("Pubsub is not started");
    }

    if (this.subscriptions.has(topic)) {
      this.subscriptions.delete(topic);
      this.peers.forEach((_, id) => this._sendSubscriptions(id, [topic], false));
    }
  }

  /**
   * Publish a `GossipObject` on a `GossipTopic`
   */
  async publishObject(topic: GossipTopic, object: GossipObject): Promise<void> {
    this.logger.verbose("Publish to topic", toJson(topic));
    await this.publish(
      this.getGossipTopicString(topic),
      encodeMessageData(topic.encoding ?? DEFAULT_ENCODING, getGossipSSZSerializer(this.config, topic)(object))
    );
  }

  /**
   * Subscribe to a `GossipTopic`
   */
  subscribeTopic(topic: GossipTopic): void {
    this.logger.verbose("Subscribe to topic", toJson(topic));
    this.subscribe(this.getGossipTopicString(topic));
  }

  /**
   * Unsubscribe to a `GossipTopic`
   */
  unsubscribeTopic(topic: GossipTopic): void {
    this.logger.verbose("Unsubscribe to topic", toJson(topic));
    this.unsubscribe(this.getGossipTopicString(topic));
  }

  /**
   * Attach a handler to a `GossipTopic`
   */
  handleTopic(topic: GossipTopic, handler: GossipHandlerFn): void {
    this.on(this.getGossipTopicString(topic), handler);
  }

  /**
   * Remove a handler from a `GossipTopic`
   */
  unhandleTopic(topic: GossipTopic, handler: GossipHandlerFn): void {
    this.off(this.getGossipTopicString(topic), handler);
  }

  async publishBeaconBlock(signedBlock: allForks.SignedBeaconBlock): Promise<void> {
    const fork = this.config.getForkName(signedBlock.message.slot);

    await this.publishObject({type: GossipType.beacon_block, fork}, signedBlock);
  }

  async publishBeaconAggregateAndProof(aggregateAndProof: phase0.SignedAggregateAndProof): Promise<void> {
    const fork = this.config.getForkName(aggregateAndProof.message.aggregate.data.slot);
    await this.publishObject({type: GossipType.beacon_aggregate_and_proof, fork}, aggregateAndProof);
  }

  async publishBeaconAttestation(attestation: phase0.Attestation, subnet: number): Promise<void> {
    const fork = this.config.getForkName(attestation.data.slot);
    await this.publishObject({type: GossipType.beacon_attestation, fork, subnet}, attestation);
  }

  async publishVoluntaryExit(voluntaryExit: phase0.SignedVoluntaryExit): Promise<void> {
    const fork = this.config.getForkName(computeEpochAtSlot(this.config, voluntaryExit.message.epoch));
    await this.publishObject({type: GossipType.voluntary_exit, fork}, voluntaryExit);
  }

  async publishProposerSlashing(proposerSlashing: phase0.ProposerSlashing): Promise<void> {
    const fork = this.config.getForkName(proposerSlashing.signedHeader1.message.slot);
    await this.publishObject({type: GossipType.proposer_slashing, fork}, proposerSlashing);
  }

  async publishAttesterSlashing(attesterSlashing: phase0.AttesterSlashing): Promise<void> {
    const fork = this.config.getForkName(attesterSlashing.attestation1.data.slot);
    await this.publishObject({type: GossipType.attester_slashing, fork}, attesterSlashing);
  }

  async publishSyncCommitteeSignature(signature: altair.SyncCommitteeSignature, subnet: number): Promise<void> {
    const fork = this.config.getForkName(signature.slot);
    await this.publishObject({type: GossipType.sync_committee, fork, subnet}, signature);
  }

  async publishContributionAndProof(contributionAndProof: altair.SignedContributionAndProof): Promise<void> {
    const fork = this.config.getForkName(contributionAndProof.message.contribution.slot);
    await this.publishObject({type: GossipType.sync_committee_contribution_and_proof, fork}, contributionAndProof);
  }

  private getGossipTopicString(topic: GossipTopic): string {
    return stringifyGossipTopic(this.forkDigestContext, topic);
  }

  private getGossipTopic(topicString: string): GossipTopic {
    let topic = this.gossipTopics.get(topicString);
    if (topic == null) {
      topic = parseGossipTopic(this.forkDigestContext, topicString);
      this.gossipTopics.set(topicString, topic);
    }
    return topic;
  }

  private logSubscriptions = (): void => {
    if (this.metrics) {
      // beacon attestation mesh gets counted separately so we can track mesh peers by subnet
      // zero out all gossip type & subnet choices, so the dashboard will register them
      for (const gossipType of Object.values(GossipType)) {
        this.metrics.gossipMeshPeersByType.set({gossipType}, 0);
      }
      for (let subnet = 0; subnet < ATTESTATION_SUBNET_COUNT; subnet++) {
        this.metrics.gossipMeshPeersByBeaconAttestationSubnet.set({subnet: subnetLabel(subnet)}, 0);
      }
      // loop through all mesh entries, count each set size
      for (const [topicString, peers] of this.mesh.entries()) {
        const topic = this.getGossipTopic(topicString);
        if (topic.type === GossipType.beacon_attestation) {
          this.metrics.gossipMeshPeersByBeaconAttestationSubnet.set({subnet: subnetLabel(topic.subnet)}, peers.size);
        } else {
          this.metrics.gossipMeshPeersByType.set({gossipType: topic.type}, peers.size);
        }
      }
    }
    this.logger.verbose("Current gossip subscriptions", {
      subscriptions: Array.from(this.subscriptions),
    });
  };
}

/**
 * Left pad subnets to two characters. Assumes ATTESTATION_SUBNET_COUNT < 99
 * Otherwise grafana sorts the mesh peers chart as: [1,11,12,13,...]
 */
function subnetLabel(subnet: number): string {
  if (subnet > 9) return String(subnet);
  else return `0${subnet}`;
}
