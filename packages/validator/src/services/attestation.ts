import {AbortSignal} from "@chainsafe/abort-controller";
import {phase0, Slot, ssz} from "@chainsafe/lodestar-types";
import {computeEpochAtSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {sleep} from "@chainsafe/lodestar-utils";
import {Api} from "@chainsafe/lodestar-api";
import {extendError, IClock, ILoggerVc} from "../util";
import {ValidatorStore} from "./validatorStore";
import {AttestationDutiesService, AttDutyAndProof} from "./attestationDuties";
import {groupAttDutiesByCommitteeIndex} from "./utils";
import {IndicesService} from "./indices";
import {toHexString} from "@chainsafe/ssz";
import {ChainHeaderTracker, HeadEventData} from "./chainHeaderTracker";
import {ValidatorEvent, ValidatorEventEmitter} from "./emitter";
import {PubkeyHex} from "../types";
import {Metrics} from "../metrics";

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
    chainHeadTracker: ChainHeaderTracker,
    private readonly metrics: Metrics | null
  ) {
    this.dutiesService = new AttestationDutiesService(
      logger,
      api,
      clock,
      validatorStore,
      indicesService,
      chainHeadTracker,
      metrics
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
    if (dutiesByCommitteeIndex.size === 0) {
      return;
    }

    // A validator should create and broadcast the attestation to the associated attestation subnet when either
    // (a) the validator has received a valid block from the expected block proposer for the assigned slot or
    // (b) one-third of the slot has transpired (SECONDS_PER_SLOT / 3 seconds after the start of slot) -- whichever comes first.
    await Promise.race([sleep(this.clock.msToSlot(slot + 1 / 3), signal), this.waitForBlockSlot(slot)]);
    this.metrics?.attesterStepCallProduceAttestation.observe(this.clock.secFromSlot(slot + 1 / 3));

    // Beacon node's endpoint produceAttestationData return data is not dependant on committeeIndex.
    // Produce a single attestation for all committees, and clone mutate before signing
    const attestationNoCommittee = await this.produceAttestation(slot);

    // Step 1. Mutate, and sign `Attestation` for each validator.
    const dutiesByAttestationData = new Map<phase0.AttestationData, AttDutyAndProof[]>();
    const signedAttestations = (
      await Promise.all(
        Array.from(dutiesByCommitteeIndex.entries()).map(async ([committeeIndex, duties]) => {
          const attestationData: phase0.AttestationData = {...attestationNoCommittee, index: committeeIndex};
          dutiesByAttestationData.set(attestationData, duties);
          return await this.signAttestations(slot, attestationData, duties);
        })
      )
    ).flat();

    // Step 2. Publish all `Attestations` in one go
    const attestationCount = signedAttestations.length;
    if (attestationCount > 0) {
      try {
        await this.api.beacon.submitPoolAttestations(signedAttestations);
        this.logger.info("Published attestations", {slot, attestationCount});
        this.metrics?.publishedAttestations.inc(attestationCount);
      } catch (e) {
        this.metrics?.attestaterError.inc({error: "publish"}, attestationCount);
        this.logger.error("Error publishing attestations", {slot, attestationCount}, e as Error);
      }
    }

    // Step 3. after all attestations are submitted, make an aggregate.
    // First, wait until the `aggregation_production_instant` (2/3rds of the way though the slot)
    await sleep(this.clock.msToSlot(slot + 2 / 3), signal);
    this.metrics?.attesterStepCallProduceAggregate.observe(this.clock.secFromSlot(slot + 2 / 3));

    // Then download, sign and publish a `SignedAggregateAndProof` for each
    // validator that is elected to aggregate for this `slot` and
    // `committeeIndex`.
    await Promise.all(
      Array.from(dutiesByAttestationData.entries()).map(([attestation, duties]) =>
        this.produceAndPublishAggregates(attestation, duties)
      )
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

  /**
   * Only one `Attestation` is downloaded from the BN. It is then signed by each
   * validator and the list of individually-signed `Attestation` objects is returned to the BN.
   */
  private async signAttestations(
    slot: Slot,
    attestationData: phase0.AttestationData,
    duties: AttDutyAndProof[]
  ): Promise<phase0.Attestation[]> {
    if (duties.length === 0) return [];

    const logCtx = {slot, index: attestationData.index};

    const currentEpoch = computeEpochAtSlot(slot);
    const signedAttestations: phase0.Attestation[] = [];

    for (const {duty} of duties) {
      const logCtxValidator = {
        ...logCtx,
        head: toHexString(attestationData.beaconBlockRoot),
        validatorIndex: duty.validatorIndex,
      };
      try {
        signedAttestations.push(await this.validatorStore.signAttestation(duty, attestationData, currentEpoch));
        this.logger.debug("Signed attestation", logCtxValidator);
      } catch (e) {
        this.metrics?.attestaterError.inc({error: "sign"});
        this.logger.error("Error signing attestation", logCtxValidator, e as Error);
      }
    }

    this.metrics?.attesterStepCallPublishAttestation.observe(this.clock.secFromSlot(attestationData.slot + 1 / 3));
    return signedAttestations;
  }

  /**
   * Performs the first step of the attesting process: downloading one `Attestation` object.
   * Beacon node's endpoint produceAttestationData return data is not dependant on committeeIndex.
   * For a validator client with many validators this allows to do a single call for all committees
   * in a slot, saving resources in both the vc and beacon node
   */
  private async produceAttestation(slot: Slot): Promise<phase0.AttestationData> {
    // Produce one attestation data per slot and committeeIndex
    const attestationRes = await this.api.validator.produceAttestationData(0, slot).catch((e: Error) => {
      this.metrics?.attestaterError.inc({error: "produce"});
      throw extendError(e, "Error producing attestation");
    });
    return attestationRes.data;
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

    this.metrics?.attesterStepCallPublishAggregate.observe(this.clock.secFromSlot(attestation.slot + 2 / 3));

    if (signedAggregateAndProofs.length > 0) {
      try {
        await this.api.validator.publishAggregateAndProofs(signedAggregateAndProofs);
        this.logger.info("Published aggregateAndProofs", {...logCtx, count: signedAggregateAndProofs.length});
        this.metrics?.publishedAggregates.inc(signedAggregateAndProofs.length);
      } catch (e) {
        this.logger.error("Error publishing aggregateAndProofs", logCtx, e as Error);
      }
    }
  }
}
