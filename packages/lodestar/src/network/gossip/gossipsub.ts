import assert from "assert";
import {utils} from "libp2p-pubsub";
import Gossipsub, {IGossipMessage, Registrar, Options} from "libp2p-gossipsub";
import {Type} from "@chainsafe/ssz";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {ILogger} from "@chainsafe/eth2.0-utils/lib/logger";

import {IGossipMessageValidator, GossipObject, GossipMessageValidatorFn} from "./interface";
import {getGossipTopic, isAttestationSubnetTopic, getSubnetFromAttestationSubnetTopic} from "./utils";
import {GossipEvent} from "./constants";
import {GOSSIP_MAX_SIZE} from "../../constants";

/**
 * This validates messages in Gossipsub and emit the transformed messages.
 * We don't want to double deserialize messages for performance benefit.
 */
export class LodestarGossipsub extends Gossipsub {
  private transformedObjects: Map<string, GossipObject>;
  private config: IBeaconConfig;
  private validator: IGossipMessageValidator;
  private readonly  logger: ILogger;

  constructor (config: IBeaconConfig, validator: IGossipMessageValidator, logger: ILogger, peerInfo: PeerInfo,
    registrar: Registrar, options: Options = {}) {
    super(peerInfo, registrar, options);
    this.transformedObjects = new Map();
    this.config = config;
    this.validator = validator;
    this.logger = logger;
  }

  public async validate(rawMessage: IGossipMessage): Promise<boolean> {
    const message: IGossipMessage = utils.normalizeInRpcMessage(rawMessage);
    assert(message.topicIDs && message.topicIDs.length === 1, `Invalid topicIDs: ${message.topicIDs}`);
    assert(message.data.length <= GOSSIP_MAX_SIZE, `Message exceeds size limit of ${GOSSIP_MAX_SIZE} bytes`);
    const topic = message.topicIDs[0];

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
      this.transformedObjects.set(this.getKey(message), transformedObj);
    }
    return isValid;
  }

  public _emitMessage(topics: string[], message: IGossipMessage): void {
    const subscribedTopics = super.getTopics();
    topics.forEach((topic) => {
      if (subscribedTopics.includes(topic)) {
        const transformedObj = this.transformedObjects.get(this.getKey(message));
        if (transformedObj) {
          super.emit(topic, transformedObj);
          this.transformedObjects.delete(this.getKey(message));
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

  private getKey(message: IGossipMessage): string {
    const key = Buffer.concat([Buffer.from(message.from as string), message.seqno]);
    return key.toString("hex");
  }

}
