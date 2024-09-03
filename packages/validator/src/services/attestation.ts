import {BLSSignature, phase0, Slot, ssz, Attestation, SignedAggregateAndProof} from "@lodestar/types";
import {ForkSeq} from "@lodestar/params";
import {
  SlotInterval,
  computeEpochAtSlot,
  endOfInterval,
  isAggregatorFromCommitteeLength,
} from "@lodestar/state-transition";
import {prettyBytes, sleep, toRootHex} from "@lodestar/utils";
import {ApiClient, routes} from "@lodestar/api";
import {ChainForkConfig} from "@lodestar/config";
import {IClock, LoggerVc} from "../util/index.js";
import {PubkeyHex} from "../types.js";
import {Metrics} from "../metrics.js";
import {ValidatorStore} from "./validatorStore.js";
import {AttestationDutiesService, AttDutyAndProof} from "./attestationDuties.js";
import {groupAttDutiesByCommitteeIndex} from "./utils.js";
import {ChainHeaderTracker} from "./chainHeaderTracker.js";
import {SyncingStatusTracker} from "./syncingStatusTracker.js";
import {ValidatorEventEmitter} from "./emitter.js";

export type AttestationServiceOpts = {
  afterBlockDelaySlotFraction?: number;
  disableAttestationGrouping?: boolean;
  distributedAggregationSelection?: boolean;
};

/**
 * Previously, submitting attestations too early may cause some attestations missed (because some clients may not queue attestations, and
 * sent peers are few) so it was configured as 1/6. See https://github.com/ChainSafe/lodestar/issues/3943
 *
 * As of Nov 2022, it's proved that submitting attestations asap is better as it avoids busy time of node at around 1/3 of slot (and could be
 * because sent peers are better than before). See https://github.com/ChainSafe/lodestar/issues/4600#issuecomment-1321546586
 */
const DEFAULT_AFTER_BLOCK_DELAY_SLOT_FRACTION = 0;

/**
 * Service that sets up and handles validator attester duties.
 */
export class AttestationService {
  private readonly dutiesService: AttestationDutiesService;

  constructor(
    private readonly logger: LoggerVc,
    private readonly api: ApiClient,
    private readonly clock: IClock,
    private readonly validatorStore: ValidatorStore,
    private readonly emitter: ValidatorEventEmitter,
    chainHeadTracker: ChainHeaderTracker,
    syncingStatusTracker: SyncingStatusTracker,
    private readonly metrics: Metrics | null,
    private readonly config: ChainForkConfig,
    private readonly opts?: AttestationServiceOpts
  ) {
    this.dutiesService = new AttestationDutiesService(
      logger,
      api,
      clock,
      validatorStore,
      chainHeadTracker,
      syncingStatusTracker,
      metrics,
      {
        distributedAggregationSelection: opts?.distributedAggregationSelection,
      }
    );

    // At most every slot, check existing duties from AttestationDutiesService and run tasks
    clock.runEverySlot(this.runAttestationTasks);
  }

  removeDutiesForKey(pubkey: PubkeyHex): void {
    this.dutiesService.removeDutiesForKey(pubkey);
  }

  private runAttestationTasks = async (slot: Slot, signal: AbortSignal): Promise<void> => {
    // Fetch info first so a potential delay is absorbed by the sleep() below
    const duties = this.dutiesService.getDutiesAtSlot(slot);
    if (duties.length === 0) {
      return;
    }

    if (this.opts?.distributedAggregationSelection) {
      // Validator in distributed cluster only has a key share, not the full private key.
      // The partial selection proofs must be exchanged for combined selection proofs by
      // calling submitBeaconCommitteeSelections on the distributed validator middleware client.
      // This will run in parallel to other attestation tasks but must be finished before starting
      // attestation aggregation as it is required to correctly determine if validator is aggregator
      // and to produce a AggregateAndProof that can be threshold aggregated by the middleware client.
      this.runDistributedAggregationSelectionTasks(duties, slot, signal).catch((e) =>
        this.logger.error("Error on attestation aggregation selection", {slot}, e)
      );
    }

    // A validator should create and broadcast the attestation to the associated attestation subnet when either
    // (a) the validator has received a valid block from the expected block proposer for the assigned slot or
    // (b) one interval of the slot has transpired (SECONDS_PER_SLOT / INTERVALS_PER_SLOT seconds after the start of slot) -- whichever comes first.
    await Promise.race([
      sleep(this.clock.msToSlotInterval(slot, SlotInterval.ATTESTATION_PROPAGATION), signal),
      this.emitter.waitForBlockSlot(slot),
    ]);
    this.metrics?.attesterStepCallProduceAttestation.observe(
      this.clock.secFromSlotInterval(slot, SlotInterval.ATTESTATION_PROPAGATION)
    );

    if (this.opts?.disableAttestationGrouping) {
      // Attestation service grouping optimization must be disabled in a distributed validator cluster as
      // middleware clients such as Charon (https://github.com/ObolNetwork/charon) expect the actual committee index
      // to be sent to produceAttestationData endpoint. This is required because the middleware client itself
      // calls produceAttestationData on the beacon node for each validator and there is a slight chance that
      // the `beacon_block_root` (LMD GHOST vote) changes between calls which would cause a conflict between
      // attestations submitted by Lodestar and other VCs in the cluster, resulting in aggregation failure.
      // See https://github.com/ChainSafe/lodestar/issues/5103 for further details and references.
      const dutiesByCommitteeIndex = groupAttDutiesByCommitteeIndex(duties);
      await Promise.all(
        Array.from(dutiesByCommitteeIndex.entries()).map(([index, duties]) =>
          this.runAttestationTasksPerCommittee(duties, slot, index, signal).catch((e) => {
            this.logger.error("Error on committee attestation routine", {slot, index}, e);
          })
        )
      );
    } else {
      // Beacon node's endpoint produceAttestationData return data is not dependent on committeeIndex.
      // Produce a single attestation for all committees and submit unaggregated attestations in one go.
      try {
        await this.runAttestationTasksGrouped(duties, slot, signal);
      } catch (e) {
        this.logger.error("Error on attestation routine", {slot}, e as Error);
      }
    }
  };

  private async runAttestationTasksPerCommittee(
    dutiesSameCommittee: AttDutyAndProof[],
    slot: Slot,
    index: number,
    signal: AbortSignal
  ): Promise<void> {
    // Produce attestation with actual committee index
    const attestation = await this.produceAttestation(index, slot);

    // Step 1. Sign `Attestation` for each validator. Then publish all `Attestations` in one go
    await this.signAndPublishAttestations(slot, attestation, dutiesSameCommittee);

    // Step 2. after all attestations are submitted, make an aggregate.
    // First, wait until the beginning of SlotInterval.AGGREGATION_PROPAGATION
    await sleep(this.clock.msToSlotInterval(slot, SlotInterval.AGGREGATION_PROPAGATION), signal);
    this.metrics?.attesterStepCallProduceAggregate.observe(
      this.clock.secFromSlotInterval(slot, SlotInterval.AGGREGATION_PROPAGATION)
    );

    // Then download, sign and publish a `SignedAggregateAndProof` for each
    // validator that is elected to aggregate for this `slot` and `committeeIndex`.
    await this.produceAndPublishAggregates(attestation, index, dutiesSameCommittee);
  }

  private async runAttestationTasksGrouped(
    dutiesAll: AttDutyAndProof[],
    slot: Slot,
    signal: AbortSignal
  ): Promise<void> {
    // Produce a single attestation for all committees, and clone mutate before signing
    const attestationNoCommittee = await this.produceAttestation(0, slot);

    // Step 1. Mutate, and sign `Attestation` for each validator. Then publish all `Attestations` in one go
    await this.signAndPublishAttestations(slot, attestationNoCommittee, dutiesAll);

    // Step 2. after all attestations are submitted, make an aggregate.
    // First, wait until the beginning of SlotInterval.AGGREGATION_PROPAGATION
    await sleep(this.clock.msToSlotInterval(slot, SlotInterval.AGGREGATION_PROPAGATION), signal);
    this.metrics?.attesterStepCallProduceAggregate.observe(
      this.clock.secFromSlotInterval(slot, SlotInterval.AGGREGATION_PROPAGATION)
    );

    const dutiesByCommitteeIndex = groupAttDutiesByCommitteeIndex(dutiesAll);
    const isPostElectra = this.config.getForkSeq(slot) >= ForkSeq.electra;

    // Then download, sign and publish a `SignedAggregateAndProof` for each
    // validator that is elected to aggregate for this `slot` and `committeeIndex`.
    await Promise.all(
      Array.from(dutiesByCommitteeIndex.entries()).map(([index, dutiesSameCommittee]) => {
        const attestationData: phase0.AttestationData = {...attestationNoCommittee, index: isPostElectra ? 0 : index};
        return this.produceAndPublishAggregates(attestationData, index, dutiesSameCommittee);
      })
    );
  }

  /**
   * Performs the first step of the attesting process: downloading one `Attestation` object.
   * Beacon node's endpoint produceAttestationData return data is not dependent on committeeIndex.
   * For a validator client with many validators this allows to do a single call for all committees
   * in a slot, saving resources in both the vc and beacon node
   *
   * Note: the actual committeeIndex must be passed in if attestation grouping is disabled
   */
  private async produceAttestation(committeeIndex: number, slot: Slot): Promise<phase0.AttestationData> {
    // Produce one attestation data per slot and committeeIndex
    return (await this.api.validator.produceAttestationData({committeeIndex, slot})).value();
  }

  /**
   * Only one `Attestation` is downloaded from the BN. It is then signed by each
   * validator and the list of individually-signed `Attestation` objects is returned to the BN.
   */
  private async signAndPublishAttestations(
    slot: Slot,
    attestationNoCommittee: phase0.AttestationData,
    duties: AttDutyAndProof[]
  ): Promise<void> {
    const signedAttestations: Attestation[] = [];
    const headRootHex = toRootHex(attestationNoCommittee.beaconBlockRoot);
    const currentEpoch = computeEpochAtSlot(slot);
    const isPostElectra = currentEpoch >= this.config.ELECTRA_FORK_EPOCH;

    await Promise.all(
      duties.map(async ({duty}) => {
        const index = isPostElectra ? 0 : duty.committeeIndex;
        const attestationData: phase0.AttestationData = {...attestationNoCommittee, index};
        const logCtxValidator = {slot, index, head: headRootHex, validatorIndex: duty.validatorIndex};

        try {
          signedAttestations.push(await this.validatorStore.signAttestation(duty, attestationData, currentEpoch));
          this.logger.debug("Signed attestation", logCtxValidator);
        } catch (e) {
          this.metrics?.attestaterError.inc({error: "sign"});
          this.logger.error("Error signing attestation", logCtxValidator, e as Error);
        }
      })
    );

    // signAndPublishAttestations() may be called before the SlotInterval.ATTESTATION_PROPAGATION cutoff time if the block was received early.
    // If we produced the block or we got the block sooner than our peers, our attestations can be dropped because
    // they reach our peers before the block. To prevent that, we wait 2 extra seconds AFTER block arrival, but
    // never beyond the SlotInterval.ATTESTATION_PROPAGATION cutoff time.
    // https://github.com/status-im/nimbus-eth2/blob/7b64c1dce4392731a4a59ee3a36caef2e0a8357a/beacon_chain/validators/validator_duties.nim#L1123
    const msToAttestationInterval = this.clock.msToSlotInterval(slot, SlotInterval.ATTESTATION_PROPAGATION);
    // submitting attestations asap to avoid busy time at around 1/3 of slot
    const afterBlockDelayMs =
      1000 *
      this.clock.secondsPerSlot *
      (this.opts?.afterBlockDelaySlotFraction ?? DEFAULT_AFTER_BLOCK_DELAY_SLOT_FRACTION);
    await sleep(Math.min(msToAttestationInterval, afterBlockDelayMs));

    this.metrics?.attesterStepCallPublishAttestation.observe(
      this.clock.secFromSlotInterval(slot, SlotInterval.ATTESTATION_PROPAGATION)
    );

    // Step 2. Publish all `Attestations` in one go
    const logCtx = {
      slot,
      // log index if attestations are published per committee
      ...(this.opts?.disableAttestationGrouping && {index: attestationNoCommittee.index}),
    };
    try {
      if (isPostElectra) {
        (await this.api.beacon.submitPoolAttestationsV2({signedAttestations})).assertOk();
      } else {
        (await this.api.beacon.submitPoolAttestations({signedAttestations})).assertOk();
      }
      this.logger.info("Published attestations", {
        ...logCtx,
        head: prettyBytes(headRootHex),
        count: signedAttestations.length,
      });
      this.metrics?.publishedAttestations.inc(signedAttestations.length);
    } catch (e) {
      // Note: metric counts only 1 since we don't know how many signedAttestations are invalid
      this.metrics?.attestaterError.inc({error: "publish"});
      this.logger.error("Error publishing attestations", logCtx, e as Error);
    }
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
    committeeIndex: number,
    duties: AttDutyAndProof[]
  ): Promise<void> {
    const logCtx = {slot: attestation.slot, index: committeeIndex};
    const isPostElectra = this.config.getForkSeq(attestation.slot) >= ForkSeq.electra;

    // No validator is aggregator, skip
    if (duties.every(({selectionProof}) => selectionProof === null)) {
      return;
    }

    this.logger.verbose("Aggregating attestations", logCtx);
    const res = isPostElectra
      ? await this.api.validator.getAggregatedAttestationV2({
          attestationDataRoot: ssz.phase0.AttestationData.hashTreeRoot(attestation),
          slot: attestation.slot,
          committeeIndex,
        })
      : await this.api.validator.getAggregatedAttestation({
          attestationDataRoot: ssz.phase0.AttestationData.hashTreeRoot(attestation),
          slot: attestation.slot,
        });
    const aggregate = res.value();
    const participants = aggregate.aggregationBits.getTrueBitIndexes().length;
    this.metrics?.numParticipantsInAggregate.observe(participants);

    const signedAggregateAndProofs: SignedAggregateAndProof[] = [];

    await Promise.all(
      duties.map(async ({duty, selectionProof}) => {
        const logCtxValidator = {...logCtx, validatorIndex: duty.validatorIndex};
        try {
          // Produce signed aggregates only for validators that are subscribed aggregators.
          if (selectionProof !== null) {
            signedAggregateAndProofs.push(
              await this.validatorStore.signAggregateAndProof(duty, selectionProof, aggregate)
            );
            this.logger.debug("Signed aggregateAndProofs", logCtxValidator);
          }
        } catch (e) {
          this.logger.error("Error signing aggregateAndProofs", logCtxValidator, e as Error);
        }
      })
    );

    this.metrics?.attesterStepCallPublishAggregate.observe(
      this.clock.secFromSlotInterval(attestation.slot, SlotInterval.AGGREGATION_PROPAGATION)
    );

    if (signedAggregateAndProofs.length > 0) {
      try {
        if (isPostElectra) {
          (await this.api.validator.publishAggregateAndProofsV2({signedAggregateAndProofs})).assertOk();
        } else {
          (await this.api.validator.publishAggregateAndProofs({signedAggregateAndProofs})).assertOk();
        }
        this.logger.info("Published aggregateAndProofs", {
          ...logCtx,
          participants,
          count: signedAggregateAndProofs.length,
        });
        this.metrics?.publishedAggregates.inc(signedAggregateAndProofs.length);
      } catch (e) {
        this.logger.error("Error publishing aggregateAndProofs", logCtx, e as Error);
      }
    }
  }

  /**
   * Performs additional attestation aggregation tasks required if validator is part of distributed cluster
   *
   * 1. Exchange partial for combined selection proofs
   * 2. Determine validators that should aggregate attestations
   * 3. Mutate duty objects to set selection proofs for aggregators
   * 4. Resubscribe validators as aggregators on beacon committee subnets
   *
   * See https://docs.google.com/document/d/1q9jOTPcYQa-3L8luRvQJ-M0eegtba4Nmon3dpO79TMk/mobilebasic
   */
  private async runDistributedAggregationSelectionTasks(
    duties: AttDutyAndProof[],
    slot: number,
    signal: AbortSignal
  ): Promise<void> {
    const partialSelections: routes.validator.BeaconCommitteeSelection[] = duties.map(
      ({duty, partialSelectionProof}) => ({
        validatorIndex: duty.validatorIndex,
        slot,
        selectionProof: partialSelectionProof as BLSSignature,
      })
    );

    this.logger.debug("Submitting partial beacon committee selection proofs", {slot, count: partialSelections.length});

    const res = await Promise.race([
      this.api.validator.submitBeaconCommitteeSelections({selections: partialSelections}),
      // Exit attestation aggregation flow if there is no response after SlotInterval.BEACON_COMMITTEE_SELECTION of slot as
      // beacon node would likely not have enough time to prepare an aggregate attestation.
      // Note that the aggregations flow is not explicitly exited but rather will be skipped
      // due to the fact that calculation of `is_aggregator` in AttestationDutiesService is not done
      // and selectionProof is set to null, meaning no validator will be considered an aggregator.
      sleep(this.clock.msToSlotInterval(slot, endOfInterval(SlotInterval.BEACON_COMMITTEE_SELECTION)), signal),
    ]);

    if (!res) {
      throw new Error("Failed to receive combined selection proofs before 1/3 of slot");
    }

    const combinedSelections = res.value();
    this.logger.debug("Received combined beacon committee selection proofs", {slot, count: combinedSelections.length});

    const beaconCommitteeSubscriptions: routes.validator.BeaconCommitteeSubscription[] = [];

    for (const dutyAndProof of duties) {
      const {validatorIndex, committeeIndex, committeeLength, committeesAtSlot} = dutyAndProof.duty;
      const logCtxValidator = {slot, index: committeeIndex, validatorIndex};

      const combinedSelection = combinedSelections.find((s) => s.validatorIndex === validatorIndex && s.slot === slot);

      if (!combinedSelection) {
        this.logger.warn("Did not receive combined beacon committee selection proof", logCtxValidator);
        continue;
      }

      const isAggregator = isAggregatorFromCommitteeLength(committeeLength, combinedSelection.selectionProof);

      if (isAggregator) {
        // Update selection proof by mutating duty object
        dutyAndProof.selectionProof = combinedSelection.selectionProof;

        // Only push subnet subscriptions with `isAggregator=true` as all validators
        // with duties for slot are already subscribed to subnets with `isAggregator=false`.
        beaconCommitteeSubscriptions.push({
          validatorIndex,
          committeesAtSlot,
          committeeIndex,
          slot,
          isAggregator,
        });
        this.logger.debug("Resubscribing validator as aggregator on beacon committee subnet", logCtxValidator);
      }
    }

    // If there are any subscriptions with aggregators, push them out to the beacon node.
    if (beaconCommitteeSubscriptions.length > 0) {
      (await this.api.validator.prepareBeaconCommitteeSubnet({subscriptions: beaconCommitteeSubscriptions})).assertOk();
      this.logger.debug("Resubscribed validators as aggregators on beacon committee subnets", {
        slot,
        count: beaconCommitteeSubscriptions.length,
      });
    }
  }
}
