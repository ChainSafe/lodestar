import {TopicValidatorResult} from "@libp2p/interface-pubsub";
import {phase0, ssz} from "@lodestar/types";
import {AttestationErrorCode, AttestationGossipErrorType} from "../../chain/errors/attestationError.js";
import {GossipAction} from "../../chain/errors/gossipValidation.js";
import {IBeaconChain} from "../../chain/interface.js";
import {validateGossipAttestation} from "../../chain/validation/attestation.js";
import {Metrics} from "../../metrics/metrics.js";
import {Err, isErr, mapOkResultsAsync, Result} from "../../util/err.js";
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

    const attestationsRes: Result<
      {attestation: phase0.Attestation; subnet: number},
      AttestationGossipErrorType
    >[] = messages.map((message) => {
      try {
        return {
          attestation: ssz.phase0.Attestation.deserialize(message.msg.data),
          subnet: getTopicSubnet(message.topic),
        };
      } catch (e) {
        return Err({
          action: GossipAction.REJECT,
          code: AttestationErrorCode.INVALID_SSZ,
          error: (e as Error).message,
        });
      }
    });

    const results = await mapOkResultsAsync(attestationsRes, (attestationsOk) =>
      validateGossipAttestation(this.chain, attestationsOk)
    );

    for (let i = 0; i < attestationsRes.length; i++) {
      const result = results[i];
      const attestationRes = attestationsRes[i];
      const message = messages[i];

      // Submit validation result to gossip
      this.reportGossipValidationResult(message, result, GossipType.beacon_attestation);

      // Import attestation
      // Note: the second `!isErr(attestationRes)` should never be an error, but required to make TS compiler happy
      if (!isErr(result) && !isErr(attestationRes)) {
        const {indexedAttestation, subnet} = result;
        this.importer.importGossipAttestation(
          attestationRes.attestation,
          indexedAttestation,
          subnet,
          message.seenTimestampSec
        );
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
