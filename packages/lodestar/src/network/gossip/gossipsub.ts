import assert from "assert";
import Gossipsub, {IGossipMessage, Options, Registrar} from "libp2p-gossipsub";
import {Type} from "@chainsafe/ssz";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";

import {GossipMessageValidatorFn, GossipObject, IGossipMessageValidator, ILodestarGossipMessage} from "./interface";
import {
  getGossipTopic,
  getMessageId,
  getSubnetFromAttestationSubnetTopic,
  isAttestationSubnetTopic,
  normalizeInRpcMessage
} from "./utils";
import {GossipEvent} from "./constants";
import {GOSSIP_MAX_SIZE} from "../../constants";

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

  constructor (config: IBeaconConfig, validator: IGossipMessageValidator, logger: ILogger, peerInfo: PeerInfo,
    registrar: Registrar, options: Options = {}) {
    super(peerInfo, registrar, options);
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
    await super.stop();
  }

  public async validate(rawMessage: IGossipMessage): Promise<boolean> {
    const message: ILodestarGossipMessage = normalizeInRpcMessage(rawMessage);
    assert(message.topicIDs && message.topicIDs.length === 1, `Invalid topicIDs: ${message.topicIDs}`);
    assert(message.data.length <= GOSSIP_MAX_SIZE, `Message exceeds size limit of ${GOSSIP_MAX_SIZE} bytes`);
    const topic = message.topicIDs[0];
    // avoid duplicate
    if (this.transformedObjects.get(message.messageId)) {
      return false;
    }

    let isValid;
    let transformedObj: GossipObject;
    try {
      const validatorFn = this.getTopicValidator(topic);
      const objSubnet = this.deserializeGossipMessage(topic, message);
      transformedObj = objSubnet.object;
      isValid = await validatorFn(transformedObj, objSubnet.subnet);
    } catch (err) {
      isValid = false;
      this.logger.error(`Cannot validate message from ${message.from}, topic ${message.topicIDs}, error: ${err}`);
    }
    if (isValid && transformedObj) {
      this.transformedObjects.set(message.messageId, {createdAt: new Date(), object: transformedObj});
    }
    return isValid;
  }

  public _emitMessage(topics: string[], message: IGossipMessage): void {
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


  private getTopicValidator(topic: string): GossipMessageValidatorFn {
    if (isAttestationSubnetTopic(topic)) {
      return this.validator.isValidIncomingCommitteeAttestation as GossipMessageValidatorFn;
    }

    let result: Function;
    switch(topic) {
      case getGossipTopic(GossipEvent.BLOCK, "ssz"):
        result = this.validator.isValidIncomingBlock;
        break;
      case getGossipTopic(GossipEvent.ATTESTATION, "ssz"):
        result =  this.validator.isValidIncomingUnaggregatedAttestation;
        break;
      case getGossipTopic(GossipEvent.AGGREGATE_AND_PROOF, "ssz"):
        result =  this.validator.isValidIncomingAggregateAndProof;
        break;
      case getGossipTopic(GossipEvent.ATTESTER_SLASHING, "ssz"):
        result =  this.validator.isValidIncomingAttesterSlashing;
        break;
      case getGossipTopic(GossipEvent.PROPOSER_SLASHING, "ssz"):
        result = this.validator.isValidIncomingProposerSlashing;
        break;
      case getGossipTopic(GossipEvent.VOLUNTARY_EXIT, "ssz"):
        result =  this.validator.isValidIncomingVoluntaryExit;
        break;
      default:
        throw new Error(`No validator for topic ${topic}`); 
    }
    return result as GossipMessageValidatorFn;
  }

  private deserializeGossipMessage(topic: string, message: IGossipMessage): { object: GossipObject; subnet?: number} {
    if (isAttestationSubnetTopic(topic)) {
      const subnet = getSubnetFromAttestationSubnetTopic(topic);
      return {object: this.config.types.Attestation.deserialize(message.data), subnet};
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let objType: Type<any>;
    switch(topic) {
      case getGossipTopic(GossipEvent.BLOCK, "ssz"):
        objType = this.config.types.SignedBeaconBlock;
        break;
      case getGossipTopic(GossipEvent.ATTESTATION, "ssz"):
        objType = this.config.types.Attestation;
        break;
      case getGossipTopic(GossipEvent.AGGREGATE_AND_PROOF, "ssz"):
        objType = this.config.types.AggregateAndProof;
        break;
      case getGossipTopic(GossipEvent.ATTESTER_SLASHING, "ssz"):
        objType = this.config.types.AttesterSlashing;
        break;
      case getGossipTopic(GossipEvent.PROPOSER_SLASHING, "ssz"):
        objType = this.config.types.ProposerSlashing;
        break;
      case getGossipTopic(GossipEvent.VOLUNTARY_EXIT, "ssz"):
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
