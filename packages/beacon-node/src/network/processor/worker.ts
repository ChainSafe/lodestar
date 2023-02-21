import {TopicValidatorResult} from "@libp2p/interface-pubsub";
import {ssz} from "@lodestar/types";
import {GossipAction} from "../../chain/errors/gossipValidation.js";
import {IBeaconChain} from "../../chain/interface.js";
import {validateGossipAttestation} from "../../chain/validation/attestation.js";
import {Metrics} from "../../metrics/metrics.js";
import {isErr, Result} from "../../util/err.js";
import {NetworkEvent, NetworkEventBus} from "../events.js";
import {GossipTopic, GossipType} from "../gossip/interface.js";
import {GossipAttestationsWork, PendingGossipsubMessage} from "./gossipAttestationQueue.js";
import {NetworkImporter, NetworkImporterModules} from "./importer.js";

export type NetworkWorkerModules = NetworkImporterModules & {
  chain: IBeaconChain;
  events: NetworkEventBus;
  metrics: Metrics | null;
};

export class NetworkWorker {
  private readonly chain: IBeaconChain;
  private readonly events: NetworkEventBus;
  private readonly importer: NetworkImporter;
  private readonly metrics: Metrics | null;

  constructor(modules: NetworkWorkerModules) {
    this.chain = modules.chain;
    this.events = modules.events;
    this.metrics = modules.metrics;
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
    for (const message of messages) {
      message.startProcessUnixSec = Date.now() / 1000;
    }

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
      this.reportGossipValidationResult(message, result, GossipType.beacon_attestation);

      // Import attestation
      if (!isErr(result)) {
        const {indexedAttestation} = result;
        this.importer.importGossipAttestation(attestation, indexedAttestation, subnet, message.seenTimestampSec);
      }
    }
  }

  private reportGossipValidationResult<T, E extends {action: GossipAction; code: string}>(
    message: PendingGossipsubMessage,
    result: Result<T, E>,
    topic: GossipType
  ): void {
    if (message.startProcessUnixSec !== null) {
      this.metrics?.gossipValidationQueueJobWaitTime.observe(
        {topic},
        message.startProcessUnixSec - message.seenTimestampSec
      );
      this.metrics?.gossipValidationQueueJobTime.observe({topic}, Date.now() / 1000 - message.startProcessUnixSec);
    }

    let acceptance: TopicValidatorResult;

    if (isErr(result)) {
      // Metrics on specific error reason
      // Note: LodestarError.code are bounded pre-declared error messages, not from arbitrary error.message
      this.metrics?.gossipValidationError.inc({topic, error: result.error.code});

      switch (result.error.action) {
        case GossipAction.IGNORE:
          this.metrics?.gossipValidationIgnore.inc({topic});
          acceptance = TopicValidatorResult.Ignore;
          break;

        case GossipAction.REJECT:
          this.metrics?.gossipValidationReject.inc({topic});
          acceptance = TopicValidatorResult.Reject;
      }
    } else {
      this.metrics?.gossipValidationAccept.inc({topic});
      acceptance = TopicValidatorResult.Accept;
    }

    this.events.emit(NetworkEvent.gossipMessageValidationResult, message.msgId, message.propagationSource, acceptance);
  }
}

function getTopicSubnet(topic: GossipTopic): number {
  if (topic.type === GossipType.beacon_attestation) {
    return topic.subnet;
  } else {
    throw Error(`expected topic beacon_attestation: ${topic.type}`);
  }
}
