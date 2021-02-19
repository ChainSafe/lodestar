import Gossipsub from "libp2p-gossipsub";
import {InMessage} from "libp2p-interfaces/src/pubsub";
import {ERR_TOPIC_VALIDATOR_REJECT, ERR_TOPIC_VALIDATOR_IGNORE} from "libp2p-gossipsub/src/constants";
import Libp2p from "libp2p";
import {CompositeType} from "@chainsafe/ssz";
import {ILogger} from "@chainsafe/lodestar-utils";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ForkDigest, SignedBeaconBlock} from "@chainsafe/lodestar-types";

import {GossipMessageValidatorFn, GossipObject, IGossipMessageValidator, ILodestarGossipMessage} from "./interface";
import {
  getSubnetFromAttestationSubnetTopic,
  isAttestationSubnetTopic,
  topicToGossipEvent,
  getGossipTopic,
  msgIdToString,
} from "./utils";
import {ExtendedValidatorResult, GossipEvent} from "./constants";
import {GOSSIP_MAX_SIZE, ATTESTATION_SUBNET_COUNT} from "../../constants";
import {computeMsgId, decodeMessageData, encodeMessageData, GossipEncoding} from "./encoding";
import {GossipValidationError} from "./errors";

type ValidatorFn = (topic: string, msg: InMessage) => Promise<void>;

/**
 * This validates messages in Gossipsub and emit the transformed messages.
 * We don't want to double deserialize messages for performance benefit.
 */
export class LodestarGossipsub extends Gossipsub {
  // Initialized in super class https://github.com/libp2p/js-libp2p-interfaces/blob/v0.5.1/src/pubsub/index.js#L130
  public topicValidators: Map<string, ValidatorFn> = new Map();
  private transformedObjects: Map<string, {createdAt: Date; object: GossipObject}>;
  private config: IBeaconConfig;
  private validator: IGossipMessageValidator;
  private interval?: NodeJS.Timeout;
  private timeToLive: number;
  private readonly logger: ILogger;

  constructor(
    config: IBeaconConfig,
    validator: IGossipMessageValidator,
    logger: ILogger,
    libp2p: Libp2p,
    options = {}
  ) {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    super(libp2p, Object.assign(options, {globalSignaturePolicy: "StrictNoSign" as const, D: 8, Dlow: 6}));
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
    super.start();
  }

  public getTopicPeerIds(topic: string): Set<string> | undefined {
    return this.topics.get(topic);
  }

  public async stop(): Promise<void> {
    if (this.interval) {
      clearInterval(this.interval);
    }

    try {
      super.stop();
    } catch (error) {
      if (error.code !== "ERR_HEARTBEAT_NO_RUNNING") {
        throw error;
      }
    }
  }

  public registerLibp2pTopicValidators(forkDigest: ForkDigest): void {
    this.topicValidators = new Map();
    for (const event of [
      GossipEvent.BLOCK,
      GossipEvent.AGGREGATE_AND_PROOF,
      GossipEvent.ATTESTER_SLASHING,
      GossipEvent.PROPOSER_SLASHING,
      GossipEvent.VOLUNTARY_EXIT,
    ]) {
      this.topicValidators.set(getGossipTopic(event, forkDigest), this.libP2pTopicValidator as ValidatorFn);
    }
    for (let subnet = 0; subnet < ATTESTATION_SUBNET_COUNT; subnet++) {
      const topic = getGossipTopic(
        GossipEvent.ATTESTATION_SUBNET,
        forkDigest,
        GossipEncoding.SSZ_SNAPPY,
        new Map([["subnet", String(subnet)]])
      );
      this.topicValidators.set(topic, this.libP2pTopicValidator as ValidatorFn);
    }
  }

  /**
   * Should throw ERR_TOPIC_VALIDATOR_IGNORE or ERR_TOPIC_VALIDATOR_REJECT
   * If we don't throw it means accept
   * Refer to https://github.com/libp2p/js-libp2p-interfaces/blob/v0.5.2/src/pubsub/index.js#L529
   * and https://github.com/ChainSafe/js-libp2p-gossipsub/blob/v0.6.3/ts/index.ts#L447
   */
  public libP2pTopicValidator = async (topic: string, message: InMessage): Promise<void> => {
    if (!this.genericIsValid(message)) {
      throw new GossipValidationError(ERR_TOPIC_VALIDATOR_REJECT);
    }
    try {
      const validatorFn = this.getLodestarTopicValidator(topic);
      const objSubnet = this.deserializeGossipMessage(topic, message);
      const transformedObj = objSubnet.object;
      const validationResult = await validatorFn(transformedObj, objSubnet.subnet);
      switch (validationResult) {
        case ExtendedValidatorResult.ignore:
          throw new GossipValidationError(ERR_TOPIC_VALIDATOR_IGNORE);
        case ExtendedValidatorResult.reject:
          throw new GossipValidationError(ERR_TOPIC_VALIDATOR_REJECT);
        default:
          // no error means accept
          this.transformedObjects.set(msgIdToString(this.getMsgId(message)), {
            createdAt: new Date(),
            object: transformedObj,
          });
      }
    } catch (e) {
      if (e.code === ERR_TOPIC_VALIDATOR_REJECT) {
        throw new GossipValidationError(ERR_TOPIC_VALIDATOR_REJECT);
      } else {
        throw new GossipValidationError(ERR_TOPIC_VALIDATOR_IGNORE);
      }
    }
  };

  /**
   * Override https://github.com/libp2p/js-libp2p-interfaces/blob/v0.5.2/src/pubsub/index.js#L428
   * we want to emit our transformed object instead of the raw message here.
   */
  public _emitMessage(message: InMessage): void {
    for (const topic of message.topicIDs) {
      const transformedObj = this.transformedObjects.get(msgIdToString(this.getMsgId(message)));
      if (transformedObj && transformedObj.object) {
        super.emit(topic, transformedObj.object);
      }
    }
  }

  /**
   * Override default `_buildMessage` to snappy-compress the data
   */
  public _buildMessage(msg: InMessage): Promise<InMessage> {
    msg.data = encodeMessageData(msg.topicIDs[0], msg.data!);
    return super._buildMessage(msg);
  }

  /**
   * Override default `getMsgId` function to cache the message-id
   */
  public getMsgId(msg: ILodestarGossipMessage): Uint8Array {
    if (!msg.msgId) {
      msg.msgId = computeMsgId(msg.topicIDs[0], msg.data!);
    }
    return msg.msgId;
  }

  private genericIsValid(message: InMessage): boolean | undefined {
    return message.topicIDs && message.topicIDs.length === 1 && message.data && message.data.length <= GOSSIP_MAX_SIZE;
  }

  private getLodestarTopicValidator(topic: string): GossipMessageValidatorFn {
    if (isAttestationSubnetTopic(topic)) {
      return this.validator.isValidIncomingCommitteeAttestation as GossipMessageValidatorFn;
    }

    let result: (...args: never[]) => Promise<ExtendedValidatorResult>;
    const gossipEvent = topicToGossipEvent(topic);
    switch (gossipEvent) {
      case GossipEvent.BLOCK:
        result = this.validator.isValidIncomingBlock;
        break;
      case GossipEvent.AGGREGATE_AND_PROOF:
        result = this.validator.isValidIncomingAggregateAndProof;
        break;
      case GossipEvent.ATTESTER_SLASHING:
        result = this.validator.isValidIncomingAttesterSlashing;
        break;
      case GossipEvent.PROPOSER_SLASHING:
        result = this.validator.isValidIncomingProposerSlashing;
        break;
      case GossipEvent.VOLUNTARY_EXIT:
        result = this.validator.isValidIncomingVoluntaryExit;
        break;
      default:
        throw new Error(`No validator for topic ${topic}`);
    }
    return result as GossipMessageValidatorFn;
  }

  private deserializeGossipMessage(topic: string, msg: InMessage): {object: GossipObject; subnet?: number} {
    const data = decodeMessageData(topic, msg.data!);

    if (isAttestationSubnetTopic(topic)) {
      const subnet = getSubnetFromAttestationSubnetTopic(topic);
      return {object: this.config.types.Attestation.deserialize(data), subnet};
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let objType: {deserialize: (data: Uint8Array) => any};
    const gossipEvent = topicToGossipEvent(topic);
    switch (gossipEvent) {
      case GossipEvent.BLOCK:
        objType = (this.config.types.SignedBeaconBlock as CompositeType<SignedBeaconBlock>).tree;
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
    return {object: objType.deserialize(data)};
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
