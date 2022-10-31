import {phase0, Slot, ssz} from "@lodestar/types";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {extendError, sleep} from "@lodestar/utils";
import {Api} from "@lodestar/api";
import {toHexString} from "@chainsafe/ssz";
import {IClock, ILoggerVc} from "../util/index.js";
import {PubkeyHex} from "../types.js";
import {Metrics} from "../metrics.js";
import {ValidatorStore} from "./validatorStore.js";
import {AttestationDutiesService, AttDutyAndProof} from "./attestationDuties.js";
import {groupAttDutiesByCommitteeIndex} from "./utils.js";
import {ChainHeaderTracker} from "./chainHeaderTracker.js";
import {ValidatorEventEmitter} from "./emitter.js";

type AttestationServiceOpts = {
  afterBlockDelaySlotFraction?: number;
};

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
    chainHeadTracker: ChainHeaderTracker,
    private readonly metrics: Metrics | null,
    private readonly opts?: AttestationServiceOpts
  ) {
    this.dutiesService = new AttestationDutiesService(logger, api, clock, validatorStore, chainHeadTracker, metrics);

    // At most every slot, check existing duties from AttestationDutiesService and run tasks
    clock.runEverySlot(this.runAttestationTasks);
  }

  removeDutiesForKey(pubkey: PubkeyHex): void {
    this.dutiesService.removeDutiesForKey(pubkey);
  }

  private runAttestationTasks = async (slot: Slot, signal: AbortSignal): Promise<void> => {
    // Fetch info first so a potential delay is absorved by the sleep() below
    const duties = this.dutiesService.getDutiesAtSlot(slot);
    if (duties.length === 0) {
      return;
    }

    // A validator should create and broadcast the attestation to the associated attestation subnet when either
    // (a) the validator has received a valid block from the expected block proposer for the assigned slot or
    // (b) one-third of the slot has transpired (SECONDS_PER_SLOT / 3 seconds after the start of slot) -- whichever comes first.
    await Promise.race([sleep(this.clock.msToSlot(slot + 1 / 3), signal), this.emitter.waitForBlockSlot(slot)]);
    this.metrics?.attesterStepCallProduceAttestation.observe(this.clock.secFromSlot(slot + 1 / 3));

    // Beacon node's endpoint produceAttestationData return data is not dependant on committeeIndex.
    // Produce a single attestation for all committees, and clone mutate before signing
    // Downstream tooling may require that produceAttestation is called with a 'real' committee index
    // So we pick the first duty's committee index - see https://github.com/ChainSafe/lodestar/issues/4687
    const attestationNoCommittee = await this.produceAttestation(duties[0].duty.committeeIndex, slot);

    // Step 1. Mutate, and sign `Attestation` for each validator. Then publish all `Attestations` in one go
    await this.signAndPublishAttestations(slot, attestationNoCommittee, duties);

    // Step 2. after all attestations are submitted, make an aggregate.
    // First, wait until the `aggregation_production_instant` (2/3rds of the way though the slot)
    await sleep(this.clock.msToSlot(slot + 2 / 3), signal);
    this.metrics?.attesterStepCallProduceAggregate.observe(this.clock.secFromSlot(slot + 2 / 3));

    const dutiesByCommitteeIndex = groupAttDutiesByCommitteeIndex(this.dutiesService.getDutiesAtSlot(slot));

    // Then download, sign and publish a `SignedAggregateAndProof` for each
    // validator that is elected to aggregate for this `slot` and
    // `committeeIndex`.
    await Promise.all(
      Array.from(dutiesByCommitteeIndex.entries()).map(([index, duties]) => {
        const attestationData: phase0.AttestationData = {...attestationNoCommittee, index};
        return this.produceAndPublishAggregates(attestationData, duties);
      })
    );
  };

  /**
   * Performs the first step of the attesting process: downloading one `Attestation` object.
   * Beacon node's endpoint produceAttestationData return data is not dependant on committeeIndex.
   * For a validator client with many validators this allows to do a single call for all committees
   * in a slot, saving resources in both the vc and beacon node
   *
   * A committee index is still passed in for the benefit of downstream tooling -
   * see https://github.com/ChainSafe/lodestar/issues/4687
   */
  private async produceAttestation(committeeIndex: number, slot: Slot): Promise<phase0.AttestationData> {
    // Produce one attestation data per slot and committeeIndex
    const attestationRes = await this.api.validator.produceAttestationData(committeeIndex, slot).catch((e: Error) => {
      this.metrics?.attestaterError.inc({error: "produce"});
      throw extendError(e, "Error producing attestation");
    });
    return attestationRes.data;
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
    const signedAttestations: phase0.Attestation[] = [];
    const headRootHex = toHexString(attestationNoCommittee.beaconBlockRoot);
    const currentEpoch = computeEpochAtSlot(slot);

    await Promise.all(
      duties.map(async ({duty}) => {
        const index = duty.committeeIndex;
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

    // signAndPublishAttestations() may be called before the 1/3 cutoff time if the block was received early.
    // If we produced the block or we got the block sooner than our peers, our attestations can be dropped because
    // they reach our peers before the block. To prevent that, we wait 2 extra seconds AFTER block arrival, but
    // never beyond the 1/3 cutoff time.
    // https://github.com/status-im/nimbus-eth2/blob/7b64c1dce4392731a4a59ee3a36caef2e0a8357a/beacon_chain/validators/validator_duties.nim#L1123
    const msToOneThirdSlot = this.clock.msToSlot(slot + 1 / 3);
    // Default = 1/6, which is half of attestation offset
    const afterBlockDelayMs = 1000 * this.clock.secondsPerSlot * (this.opts?.afterBlockDelaySlotFraction ?? 1 / 6);
    await sleep(Math.min(msToOneThirdSlot, afterBlockDelayMs));

    this.metrics?.attesterStepCallPublishAttestation.observe(this.clock.secFromSlot(slot + 1 / 3));

    // Step 2. Publish all `Attestations` in one go
    try {
      await this.api.beacon.submitPoolAttestations(signedAttestations);
      this.logger.info("Published attestations", {slot, count: signedAttestations.length});
      this.metrics?.publishedAttestations.inc(signedAttestations.length);
    } catch (e) {
      // Note: metric counts only 1 since we don't know how many signedAttestations are invalid
      this.metrics?.attestaterError.inc({error: "publish"});
      this.logger.error("Error publishing attestations", {slot}, e as Error);
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
    this.metrics?.numParticipantsInAggregate.observe(aggregate.data.aggregationBits.getTrueBitIndexes().length);

    const signedAggregateAndProofs: phase0.SignedAggregateAndProof[] = [];

    await Promise.all(
      duties.map(async ({duty, selectionProof}) => {
        const logCtxValidator = {...logCtx, validatorIndex: duty.validatorIndex};
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
      })
    );

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
