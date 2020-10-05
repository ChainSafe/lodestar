import Gossipsub from "libp2p-gossipsub";
import {assert} from "@chainsafe/lodestar-utils";
import {InMessage} from "libp2p-interfaces/src/pubsub";
import {ERR_TOPIC_VALIDATOR_REJECT, ERR_TOPIC_VALIDATOR_IGNORE} from "libp2p-gossipsub/src/constants";
import {Type} from "@chainsafe/ssz";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ILogger} from "@chainsafe/lodestar-utils";
import {compress, uncompress} from "snappyjs";

import {GossipMessageValidatorFn, GossipObject, IGossipMessageValidator, GossipValidationError} from "./interface";
import {
  getMessageId,
  getSubnetFromAttestationSubnetTopic,
  isAttestationSubnetTopic,
  topicToGossipEvent,
  getGossipTopic,
} from "./utils";
import {ExtendedValidatorResult, GossipEvent} from "./constants";
import {GOSSIP_MAX_SIZE, ATTESTATION_SUBNET_COUNT} from "../../constants";
import {getTopicEncoding, GossipEncoding} from "./encoding";
import {Libp2p} from "libp2p-gossipsub/src/interfaces";
import {ForkDigest} from "@chainsafe/lodestar-types";

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
    super(libp2p, Object.assign(options, {msgIdFn: getMessageId, signMessages: false, strictSigning: false}));
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
    } catch (error) {
      if (error.code !== "ERR_HEARTBEAT_NO_RUNNING") {
        throw error;
      }
    }
  }

  public registerLibp2pTopicValidators(forkDigest: ForkDigest): void {
    this.topicValidators = new Map();
    [
      GossipEvent.BLOCK,
      GossipEvent.AGGREGATE_AND_PROOF,
      GossipEvent.ATTESTER_SLASHING,
      GossipEvent.PROPOSER_SLASHING,
      GossipEvent.VOLUNTARY_EXIT,
    ].forEach((event) =>
      this.topicValidators.set(getGossipTopic(event, forkDigest), this.libP2pTopicValidator as ValidatorFn)
    );
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
   * Refer to https://github.com/libp2p/js-libp2p-interfaces/blob/v0.5.1/src/pubsub/index.js#L515
   * and https://github.com/ChainSafe/js-libp2p-gossipsub/blob/v0.6.0/ts/index.ts#L442
   */
  public libP2pTopicValidator = async (topic: string, message: InMessage): Promise<void> => {
    if (!this.genericIsValid(message)) {
      throw new GossipValidationError(ERR_TOPIC_VALIDATOR_REJECT);
    }
    // Gossipsub checks this already
    assert.true(
      this.transformedObjects.get(getMessageId(message)) === undefined,
      "Duplicate message for topic " + topic
    );
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
          this.transformedObjects.set(getMessageId(message), {createdAt: new Date(), object: transformedObj!});
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
   * Override https://github.com/libp2p/js-libp2p-interfaces/blob/v0.5.1/src/pubsub/index.js#L414
   * we want to emit our transformed object instead of the raw message here.
   */
  public _emitMessage(message: InMessage): void {
    message.topicIDs.forEach((topic) => {
      const transformedObj = this.transformedObjects.get(getMessageId(message));
      if (transformedObj && transformedObj.object) {
        super.emit(topic, transformedObj.object);
      }
    });
  }

  /**
   * Override https://github.com/ChainSafe/js-libp2p-gossipsub/blob/v0.6.0/ts/index.ts#L1029
   */
  public _publish(message: InMessage): Promise<void> {
    assert.true(message.topicIDs && message.topicIDs.length === 1, "lodestar only support 1 topic per message");
    assert.true(!!message.data, "message to publish should have data");
    const encoding = getTopicEncoding(message.topicIDs[0]);
    if (encoding === GossipEncoding.SSZ_SNAPPY) {
      message.data = compress<Uint8Array>(message.data!);
    }
    return super._publish(message);
  }

  private genericIsValid(message: InMessage): boolean | undefined {
    return message.topicIDs && message.topicIDs.length === 1 && message.data && message.data.length <= GOSSIP_MAX_SIZE;
  }

  private getLodestarTopicValidator(topic: string): GossipMessageValidatorFn {
    if (isAttestationSubnetTopic(topic)) {
      return this.validator.isValidIncomingCommitteeAttestation as GossipMessageValidatorFn;
    }

    let result: Function;
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

  private deserializeGossipMessage(topic: string, message: InMessage): {object: GossipObject; subnet?: number} {
    if (getTopicEncoding(topic) === GossipEncoding.SSZ_SNAPPY) {
      message.data = uncompress(message.data!);
    }
    if (isAttestationSubnetTopic(topic)) {
      const subnet = getSubnetFromAttestationSubnetTopic(topic);
      return {object: this.config.types.Attestation.deserialize(message.data!), subnet};
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let objType: Type<any>;
    const gossipEvent = topicToGossipEvent(topic);
    switch (gossipEvent) {
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
    return {object: objType.deserialize(message.data!)};
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
