import {AbortSignal} from "abort-controller";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {phase0, Slot, CommitteeIndex} from "@chainsafe/lodestar-types";
import {computeEpochAtSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {ILogger, prettyBytes, sleep} from "@chainsafe/lodestar-utils";
import {IApiClient} from "../api";
import {extendError, notAborted, IClock} from "../util";
import {ValidatorStore} from "./validatorStore";
import {AttestationDutiesService, AttDutyAndProof} from "./attestationDuties";
import {groupAttDutiesByCommitteeIndex} from "./utils";
import {IndicesService} from "./indices";

/**
 * Service that sets up and handles validator attester duties.
 */
export class AttestationService {
  private readonly dutiesService: AttestationDutiesService;

  constructor(
    private readonly config: IBeaconConfig,
    private readonly logger: ILogger,
    private readonly apiClient: IApiClient,
    private readonly clock: IClock,
    private readonly validatorStore: ValidatorStore,
    indicesService: IndicesService
  ) {
    this.dutiesService = new AttestationDutiesService(config, logger, apiClient, clock, validatorStore, indicesService);

    // At most every slot, check existing duties from AttestationDutiesService and run tasks
    clock.runEverySlot(this.runAttestationTasks);
  }

  private runAttestationTasks = async (slot: Slot, signal: AbortSignal): Promise<void> => {
    // Fetch info first so a potential delay is absorved by the sleep() below
    const dutiesByCommitteeIndex = groupAttDutiesByCommitteeIndex(this.dutiesService.getDutiesAtSlot(slot));

    // Lighthouse recommends to always wait to 1/3 of the slot, even if the block comes early
    await sleep(this.clock.msToSlotFraction(slot, 1 / 3), signal);

    // await for all so if the Beacon node is overloaded it auto-throttles
    // TODO: This approach is convervative to reduce the node's load, review
    await Promise.all(
      Array.from(dutiesByCommitteeIndex.entries()).map(async ([committeeIndex, duties]) => {
        if (duties.length === 0) return;
        await this.publishAttestationsAndAggregates(slot, committeeIndex, duties, signal).catch((e) => {
          if (notAborted(e)) this.logger.error("Error on attestations routine", {slot, committeeIndex}, e);
        });
      })
    );
  };

  private async publishAttestationsAndAggregates(
    slot: Slot,
    committeeIndex: CommitteeIndex,
    duties: AttDutyAndProof[],
    signal: AbortSignal
  ): Promise<void> {
    // Step 1. Download, sign and publish an `Attestation` for each validator.
    const attestation = await this.produceAndPublishAttestations(slot, committeeIndex, duties);

    // Step 2. If an attestation was produced, make an aggregate.
    // First, wait until the `aggregation_production_instant` (2/3rds of the way though the slot)
    await sleep(this.clock.msToSlotFraction(slot, 2 / 3), signal);

    // Then download, sign and publish a `SignedAggregateAndProof` for each
    // validator that is elected to aggregate for this `slot` and
    // `committeeIndex`.
    await this.produceAndPublishAggregates(attestation, duties);
  }

  /**
   * Performs the first step of the attesting process: downloading `Attestation` objects,
   * signing them and returning them to the validator.
   *
   * https://github.com/ethereum/eth2.0-specs/blob/v0.12.1/specs/phase0/validator.md#attesting
   *
   * Only one `Attestation` is downloaded from the BN. It is then signed by each
   * validator and the list of individually-signed `Attestation` objects is returned to the BN.
   */
  private async produceAndPublishAttestations(
    slot: Slot,
    committeeIndex: CommitteeIndex,
    duties: AttDutyAndProof[]
  ): Promise<phase0.AttestationData> {
    const logCtx = {slot, index: committeeIndex};

    // Produce one attestation data per slot and committeeIndex
    const attestation = await this.apiClient.validator.produceAttestationData(committeeIndex, slot).catch((e) => {
      throw extendError(e, "Error producing attestation");
    });

    const currentEpoch = computeEpochAtSlot(this.config, slot);
    const signedAttestations: phase0.Attestation[] = [];

    for (const {duty} of duties) {
      const logCtxValidator = {...logCtx, validator: prettyBytes(duty.pubkey)};
      try {
        signedAttestations.push(await this.validatorStore.signAttestation(duty, attestation, currentEpoch));
        this.logger.debug("Signed attestation", logCtxValidator);
      } catch (e) {
        if (notAborted(e)) this.logger.error("Error signing attestation", logCtxValidator, e);
      }
    }

    if (signedAttestations.length > 0) {
      try {
        await this.apiClient.beacon.pool.submitAttestations(signedAttestations);
        this.logger.info("Published attestations", {...logCtx, count: signedAttestations.length});
      } catch (e) {
        if (notAborted(e)) this.logger.error("Error publishing attestations", logCtx, e);
      }
    }

    return attestation;
  }

  /**
   * Performs the second step of the attesting process: downloading an aggregated `Attestation`,
   * converting it into a `SignedAggregateAndProof` and returning it to the BN.
   *
   * https://github.com/ethereum/eth2.0-specs/blob/v0.12.1/specs/phase0/validator.md#broadcast-aggregate
   *
   * Only one aggregated `Attestation` is downloaded from the BN. It is then signed
   * by each validator and the list of individually-signed `SignedAggregateAndProof` objects is
   * returned to the BN.
   */
  private async produceAndPublishAggregates(
    attestation: phase0.AttestationData,
    duties: AttDutyAndProof[]
  ): Promise<void> {
    const logCtx = {slot: attestation.slot, index: attestation.index};

    // No validator is aggregator, skip
    if (duties.every(({selectionProof}) => selectionProof === null)) {
      return;
    }

    this.logger.verbose("Aggregating attestations", logCtx);
    const aggregate = await this.apiClient.validator
      .getAggregatedAttestation(this.config.types.phase0.AttestationData.hashTreeRoot(attestation), attestation.slot)
      .catch((e) => {
        throw extendError(e, "Error producing aggregateAndProofs");
      });

    const signedAggregateAndProofs: phase0.SignedAggregateAndProof[] = [];

    for (const {duty, selectionProof} of duties) {
      const logCtxValidator = {...logCtx, validator: prettyBytes(duty.pubkey)};
      try {
        // Produce signed aggregates only for validators that are subscribed aggregators.
        if (selectionProof !== null) {
          signedAggregateAndProofs.push(
            await this.validatorStore.signAggregateAndProof(duty, selectionProof, aggregate)
          );
          this.logger.debug("Signed aggregateAndProofs", logCtxValidator);
        }
      } catch (e) {
        if (notAborted(e)) this.logger.error("Error signing aggregateAndProofs", logCtxValidator, e);
      }
    }

    if (signedAggregateAndProofs.length > 0) {
      try {
        await this.apiClient.validator.publishAggregateAndProofs(signedAggregateAndProofs);
        this.logger.info("Published aggregateAndProofs", {...logCtx, count: signedAggregateAndProofs.length});
      } catch (e) {
        if (notAborted(e)) this.logger.error("Error publishing aggregateAndProofs", logCtx, e);
      }
    }
  }
}
