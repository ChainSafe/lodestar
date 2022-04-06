import {AbortSignal} from "@chainsafe/abort-controller";
import {phase0, Slot, CommitteeIndex, ssz} from "@chainsafe/lodestar-types";
import {computeEpochAtSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {sleep} from "@chainsafe/lodestar-utils";
import {Api} from "@chainsafe/lodestar-api";
import {extendError, IClock, ILoggerVc} from "../util/index.js";
import {ValidatorStore} from "./validatorStore.js";
import {AttestationDutiesService, AttDutyAndProof} from "./attestationDuties.js";
import {groupAttDutiesByCommitteeIndex} from "./utils.js";
import {IndicesService} from "./indices.js";
import {toHexString} from "@chainsafe/ssz";
import {ChainHeaderTracker, HeadEventData} from "./chainHeaderTracker.js";
import {ValidatorEvent, ValidatorEventEmitter} from "./emitter.js";
import {PubkeyHex} from "../types.js";

/**
 * Service that sets up and handles validator attester duties.
 */
export class AttestationService {
  private readonly dutiesService: AttestationDutiesService;

  constructor(
    private readonly logger: ILoggerVc,
    private readonly api: Api,
    private readonly clock: IClock,
    private readonly validatorStore: ValidatorStore,
    private readonly emitter: ValidatorEventEmitter,
    indicesService: IndicesService,
    chainHeadTracker: ChainHeaderTracker
  ) {
    this.dutiesService = new AttestationDutiesService(
      logger,
      api,
      clock,
      validatorStore,
      indicesService,
      chainHeadTracker
    );

    // At most every slot, check existing duties from AttestationDutiesService and run tasks
    clock.runEverySlot(this.runAttestationTasks);
  }

  removeDutiesForKey(pubkey: PubkeyHex): void {
    this.dutiesService.removeDutiesForKey(pubkey);
  }

  private runAttestationTasks = async (slot: Slot, signal: AbortSignal): Promise<void> => {
    // Fetch info first so a potential delay is absorved by the sleep() below
    const dutiesByCommitteeIndex = groupAttDutiesByCommitteeIndex(this.dutiesService.getDutiesAtSlot(slot));

    // A validator should create and broadcast the attestation to the associated attestation subnet when either
    // (a) the validator has received a valid block from the expected block proposer for the assigned slot or
    // (b) one-third of the slot has transpired (SECONDS_PER_SLOT / 3 seconds after the start of slot) -- whichever comes first.
    await Promise.race([sleep(this.clock.msToSlotFraction(slot, 1 / 3), signal), this.waitForBlockSlot(slot)]);

    // await for all so if the Beacon node is overloaded it auto-throttles
    // TODO: This approach is convervative to reduce the node's load, review
    await Promise.all(
      Array.from(dutiesByCommitteeIndex.entries()).map(async ([committeeIndex, duties]) => {
        if (duties.length === 0) return;
        await this.publishAttestationsAndAggregates(slot, committeeIndex, duties, signal).catch((e: Error) => {
          this.logger.error("Error on attestations routine", {slot, committeeIndex}, e);
        });
      })
    );
  };

  private waitForBlockSlot(slot: Slot): Promise<void> {
    let headListener: (head: HeadEventData) => void;

    const onDone = (): void => {
      this.emitter.off(ValidatorEvent.chainHead, headListener);
    };

    return new Promise((resolve) => {
      headListener = (head: HeadEventData): void => {
        if (head.slot >= slot) {
          onDone();
          resolve();
        }
      };
      this.emitter.on(ValidatorEvent.chainHead, headListener);
    });
  }

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
    const attestationRes = await this.api.validator.produceAttestationData(committeeIndex, slot).catch((e: Error) => {
      throw extendError(e, "Error producing attestation");
    });
    const attestation = attestationRes.data;

    const currentEpoch = computeEpochAtSlot(slot);
    const signedAttestations: phase0.Attestation[] = [];

    for (const {duty} of duties) {
      const logCtxValidator = {
        ...logCtx,
        head: toHexString(attestation.beaconBlockRoot),
        validatorIndex: duty.validatorIndex,
      };
      try {
        signedAttestations.push(await this.validatorStore.signAttestation(duty, attestation, currentEpoch));
        this.logger.debug("Signed attestation", logCtxValidator);
      } catch (e) {
        this.logger.error("Error signing attestation", logCtxValidator, e as Error);
      }
    }

    if (signedAttestations.length > 0) {
      try {
        await this.api.beacon.submitPoolAttestations(signedAttestations);
        this.logger.info("Published attestations", {...logCtx, count: signedAttestations.length});
      } catch (e) {
        this.logger.error("Error publishing attestations", logCtx, e as Error);
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
    const aggregate = await this.api.validator
      .getAggregatedAttestation(ssz.phase0.AttestationData.hashTreeRoot(attestation), attestation.slot)
      .catch((e: Error) => {
        throw extendError(e, "Error producing aggregateAndProofs");
      });

    const signedAggregateAndProofs: phase0.SignedAggregateAndProof[] = [];

    for (const {duty, selectionProof} of duties) {
      const logCtxValidator = {...logCtx, validator: toHexString(duty.pubkey), validatorIndex: duty.validatorIndex};
      try {
        // Produce signed aggregates only for validators that are subscribed aggregators.
        if (selectionProof !== null) {
          signedAggregateAndProofs.push(
            await this.validatorStore.signAggregateAndProof(duty, selectionProof, aggregate.data)
          );
          this.logger.debug("Signed aggregateAndProofs", logCtxValidator);
        }
      } catch (e) {
        this.logger.error("Error signing aggregateAndProofs", logCtxValidator, e as Error);
      }
    }

    if (signedAggregateAndProofs.length > 0) {
      try {
        await this.api.validator.publishAggregateAndProofs(signedAggregateAndProofs);
        this.logger.info("Published aggregateAndProofs", {...logCtx, count: signedAggregateAndProofs.length});
      } catch (e) {
        this.logger.error("Error publishing aggregateAndProofs", logCtx, e as Error);
      }
    }
  }
}
