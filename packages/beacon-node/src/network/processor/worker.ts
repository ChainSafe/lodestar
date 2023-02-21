import {TopicValidatorResult} from "@libp2p/interface-pubsub";
import {ssz} from "@lodestar/types";
import {AttestationGossipErrorType} from "../../chain/errors/attestationError.js";
import {GossipAction} from "../../chain/errors/gossipValidation.js";
import {IBeaconChain} from "../../chain/interface.js";
import {validateGossipAttestation} from "../../chain/validation/attestation.js";
import {isErr, Result} from "../../util/err.js";
import {NetworkEvent, NetworkEventBus} from "../events.js";
import {GossipTopic, GossipType} from "../gossip/interface.js";
import {GossipAttestationsWork} from "./gossipAttestationQueue.js";
import {NetworkImporter, NetworkImporterModules} from "./importer.js";

export type NetworkWorkerModules = NetworkImporterModules & {
  chain: IBeaconChain;
  events: NetworkEventBus;
};

export class NetworkWorker {
  private readonly chain: IBeaconChain;
  private readonly events: NetworkEventBus;
  private readonly importer: NetworkImporter;

  constructor(modules: NetworkWorkerModules) {
    this.chain = modules.chain;
    this.events = modules.events;
    this.importer = new NetworkImporter(modules);
  }

  /**
   * Task performed by "virtual" worker on the main thread:
   * - validate attestations
   * - submit validation result to gossipsub
   * - import attestations
   *
   * Should only start if regen queue and BLS queue have available spots
   */
  async processGossipAttestations({messages}: GossipAttestationsWork): Promise<void> {
    const attestations = messages.map((message) => ({
      attestation: ssz.phase0.Attestation.deserialize(message.msg.data),
      subnet: getTopicSubnet(message.topic),
    }));

    const results = await validateGossipAttestation(this.chain, attestations);

    for (let i = 0; i < attestations.length; i++) {
      // TODO: Are not of the same length since SSZ deserialization may fail
      const result = results[i];
      const {attestation, subnet} = attestations[i];
      const message = messages[i];

      // Submit validation result to gossip
      this.events.emit(
        NetworkEvent.gossipMessageValidationResult,
        message.msgId,
        message.propagationSource,
        toValidationResult(result)
      );

      // Import attestation
      if (!isErr(result)) {
        const {indexedAttestation} = result;
        this.importer.importGossipAttestation(attestation, indexedAttestation, subnet, message.seenTimestampSec);
      }
    }
  }
}

function toValidationResult<T>(result: Result<T, AttestationGossipErrorType>): TopicValidatorResult {
  if (isErr(result)) {
    switch (result.error.action) {
      case GossipAction.IGNORE:
        return TopicValidatorResult.Ignore;
      case GossipAction.REJECT:
        return TopicValidatorResult.Reject;
    }
  } else {
    return TopicValidatorResult.Accept;
  }
}

function getTopicSubnet(topic: GossipTopic): number {
  if (topic.type === GossipType.beacon_attestation) {
    return topic.subnet;
  } else {
    throw Error(`expected topic beacon_attestation: ${topic.type}`);
  }
}
