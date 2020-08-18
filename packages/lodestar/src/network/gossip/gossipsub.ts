import PeerId from "peer-id";
import Gossipsub from "libp2p-gossipsub";
import {Registrar, Peer} from "libp2p-gossipsub/src/peer";
import {Message} from "libp2p-gossipsub/src/message";
import {Type} from "@chainsafe/ssz";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import {assert} from "@chainsafe/lodestar-utils";
import {compress, uncompress} from "snappyjs";

import {GossipMessageValidatorFn, GossipObject, IGossipMessageValidator, ILodestarGossipMessage} from "./interface";
import {
  getMessageId,
  getSubnetFromAttestationSubnetTopic,
  isAttestationSubnetTopic,
  normalizeInRpcMessage,
  topicToGossipEvent
} from "./utils";
import {GossipEvent, ExtendedValidatorResult} from "./constants";
import {GOSSIP_MAX_SIZE} from "../../constants";
import {getTopicEncoding, GossipEncoding} from "./encoding";

/**
 * This validates messages in Gossipsub and emit the transformed messages.
 * We don't want to double deserialize messages for performance benefit.
 */
export class LodestarGossipsub extends Gossipsub {
  private transformedObjects: Map<string, {createdAt: Date; object: GossipObject}>;
  private config: IBeaconConfig;
  private validator: IGossipMessageValidator;
  private interval: NodeJS.Timeout;
  private timeToLive: number;
  private readonly  logger: ILogger;

  constructor (config: IBeaconConfig, validator: IGossipMessageValidator, logger: ILogger, peerId: PeerId,
    registrar: Registrar, options = {}) {
    super(peerId, registrar, Object.assign(options, {msgIdFn: getMessageId}));
    this.transformedObjects = new Map();
    this.config = config;
    this.validator = validator;
    // This can be epoch/daily/hourly ...
    this.timeToLive = this.config.params.SLOTS_PER_EPOCH * this.config.params.SECONDS_PER_SLOT * 1000;
    this.logger = logger;
  }

  public async start(): Promise<void> {
    if (!this.interval) {
      this.interval = setInterval(this.cleanUp.bind(this), this.timeToLive);
    }
    await super.start();
  }

  public async stop(): Promise<void> {
    if (this.interval) {
      clearInterval(this.interval);
    }

    try {
      await super.stop();
    }
    catch(error) {
      if (error.code !== "ERR_HEARTBEAT_NO_RUNNING") {
        throw error;
      }
    }
  }

  public async validate(rawMessage: Message, peer: Peer): Promise<boolean> {
    const message: ILodestarGossipMessage = normalizeInRpcMessage(rawMessage);
    assert.true(Boolean(message.topicIDs), "topicIds is not defined");
    assert.equal(message.topicIDs.length, 1, "topicIds array must contain one item");
    assert.lte(message.data.length, GOSSIP_MAX_SIZE, "Message exceeds byte size limit");
    const topic = message.topicIDs[0];
    // avoid duplicate
    if (this.transformedObjects.get(message.messageId)) {
      return false;
    }

    let validationResult;
    let transformedObj: GossipObject;
    try {
      const validatorFn = this.getTopicValidator(topic);
      const objSubnet = this.deserializeGossipMessage(topic, message);
      transformedObj = objSubnet.object;
      validationResult = await validatorFn(transformedObj, objSubnet.subnet);
    } catch (err) {
      validationResult = ExtendedValidatorResult.reject;
      this.logger.error(`Cannot validate message from ${message.from}, topic ${message.topicIDs}, error: ${err}`);
    }
    const isValid = this._processTopicValidatorResult(topic, peer, message, validationResult);
    if (isValid && transformedObj) {
      this.transformedObjects.set(message.messageId, {createdAt: new Date(), object: transformedObj});
    }
    return isValid;
  }

  /**
   * TODO: Should be removed in gossip 1.1
   * @param topic
   * @param peer
   * @param message
   * @param result
   */
  public _processTopicValidatorResult (topic: string, peer: Peer, message: Message, result: unknown): boolean {
    if (result === ExtendedValidatorResult.accept) {
      return true;
    }
    return false;
  }

  public _emitMessage(topics: string[], message: Message): void {
    const subscribedTopics = super.getTopics();
    topics.forEach((topic) => {
      if (subscribedTopics.includes(topic)) {
        const transformedObj = this.transformedObjects.get(getMessageId(message));
        if (transformedObj && transformedObj.object) {
          super.emit(topic, transformedObj.object);
        }
      }
    });
  }

  publish(topic: string, data: Buffer): void {
    const encoding = getTopicEncoding(topic);
    if(encoding === GossipEncoding.SSZ_SNAPPY) {
      data = compress(data);
    }
    return super.publish(topic, data);
  }

  private getTopicValidator(topic: string): GossipMessageValidatorFn {
    if (isAttestationSubnetTopic(topic)) {
      return this.validator.isValidIncomingCommitteeAttestation as GossipMessageValidatorFn;
    }

    let result: Function;
    const gossipEvent = topicToGossipEvent(topic);
    switch(gossipEvent) {
      case GossipEvent.BLOCK:
        result = this.validator.isValidIncomingBlock;
        break;
      case GossipEvent.AGGREGATE_AND_PROOF:
        result =  this.validator.isValidIncomingAggregateAndProof;
        break;
      case GossipEvent.ATTESTER_SLASHING:
        result =  this.validator.isValidIncomingAttesterSlashing;
        break;
      case GossipEvent.PROPOSER_SLASHING:
        result = this.validator.isValidIncomingProposerSlashing;
        break;
      case GossipEvent.VOLUNTARY_EXIT:
        result =  this.validator.isValidIncomingVoluntaryExit;
        break;
      default:
        throw new Error(`No validator for topic ${topic}`);
    }
    return result as GossipMessageValidatorFn;
  }

  private deserializeGossipMessage(topic: string, message: Message): { object: GossipObject; subnet?: number} {
    if(getTopicEncoding(topic) === GossipEncoding.SSZ_SNAPPY) {
      message.data = uncompress(message.data);
    }
    if (isAttestationSubnetTopic(topic)) {
      const subnet = getSubnetFromAttestationSubnetTopic(topic);
      return {object: this.config.types.Attestation.deserialize(message.data), subnet};
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let objType: Type<any>;
    const gossipEvent = topicToGossipEvent(topic);
    switch(gossipEvent) {
      case GossipEvent.BLOCK:
        objType = this.config.types.SignedBeaconBlock;
        break;
      case GossipEvent.AGGREGATE_AND_PROOF:
        objType = this.config.types.SignedAggregateAndProof;
        break;
      case GossipEvent.ATTESTER_SLASHING:
        objType = this.config.types.AttesterSlashing;
        break;
      case GossipEvent.PROPOSER_SLASHING:
        objType = this.config.types.ProposerSlashing;
        break;
      case GossipEvent.VOLUNTARY_EXIT:
        objType = this.config.types.SignedVoluntaryExit;
        break;
      default:
        throw new Error(`Don't know how to deserialize object received under topic ${topic}`);
    }
    return {object: objType.deserialize(message.data)};
  }

  private cleanUp(): void {
    const keysToDelete: string[] = [];
    for (const [key, val] of this.transformedObjects) {
      if (Date.now() - val.createdAt.getTime() > this.timeToLive) {
        keysToDelete.push(key);
      }
    }
    for (const key of keysToDelete) {
      this.transformedObjects.delete(key);
    }
  }

}
