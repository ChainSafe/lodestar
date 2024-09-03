import {ChainForkConfig} from "@lodestar/config";
import {Slot, CommitteeIndex, altair, Root, BLSSignature} from "@lodestar/types";
import {sleep} from "@lodestar/utils";
import {SlotInterval, computeEpochAtSlot, endOfInterval, isSyncCommitteeAggregator} from "@lodestar/state-transition";
import {ApiClient, routes} from "@lodestar/api";
import {IClock, LoggerVc} from "../util/index.js";
import {PubkeyHex} from "../types.js";
import {Metrics} from "../metrics.js";
import {ValidatorStore} from "./validatorStore.js";
import {SyncCommitteeDutiesService, SyncDutyAndProofs} from "./syncCommitteeDuties.js";
import {groupSyncDutiesBySubcommitteeIndex, SubcommitteeDuty} from "./utils.js";
import {ChainHeaderTracker} from "./chainHeaderTracker.js";
import {ValidatorEventEmitter} from "./emitter.js";
import {SyncingStatusTracker} from "./syncingStatusTracker.js";

export type SyncCommitteeServiceOpts = {
  scAfterBlockDelaySlotFraction?: number;
  distributedAggregationSelection?: boolean;
};

/**
 * Service that sets up and handles validator sync duties.
 */
export class SyncCommitteeService {
  private readonly dutiesService: SyncCommitteeDutiesService;

  constructor(
    private readonly config: ChainForkConfig,
    private readonly logger: LoggerVc,
    private readonly api: ApiClient,
    private readonly clock: IClock,
    private readonly validatorStore: ValidatorStore,
    private readonly emitter: ValidatorEventEmitter,
    private readonly chainHeaderTracker: ChainHeaderTracker,
    readonly syncingStatusTracker: SyncingStatusTracker,
    private readonly metrics: Metrics | null,
    private readonly opts?: SyncCommitteeServiceOpts
  ) {
    this.dutiesService = new SyncCommitteeDutiesService(
      config,
      logger,
      api,
      clock,
      validatorStore,
      syncingStatusTracker,
      metrics,
      {
        distributedAggregationSelection: opts?.distributedAggregationSelection,
      }
    );

    // At most every slot, check existing duties from SyncCommitteeDutiesService and run tasks
    clock.runEverySlot(this.runSyncCommitteeTasks);
  }

  removeDutiesForKey(pubkey: PubkeyHex): void {
    this.dutiesService.removeDutiesForKey(pubkey);
  }

  private runSyncCommitteeTasks = async (slot: Slot, signal: AbortSignal): Promise<void> => {
    try {
      // Before altair fork no need to check duties
      if (computeEpochAtSlot(slot) < this.config.ALTAIR_FORK_EPOCH) {
        return;
      }

      // Fetch info first so a potential delay is absorbed by the sleep() below
      const dutiesAtSlot = await this.dutiesService.getDutiesAtSlot(slot);
      if (dutiesAtSlot.length === 0) {
        return;
      }

      if (this.opts?.distributedAggregationSelection) {
        // Validator in distributed cluster only has a key share, not the full private key.
        // The partial selection proofs must be exchanged for combined selection proofs by
        // calling submitSyncCommitteeSelections on the distributed validator middleware client.
        // This will run in parallel to other sync committee tasks but must be finished before starting
        // sync committee contributions as it is required to correctly determine if validator is aggregator
        // and to produce a ContributionAndProof that can be threshold aggregated by the middleware client.
        this.runDistributedAggregationSelectionTasks(dutiesAtSlot, slot, signal).catch((e) =>
          this.logger.error("Error on sync committee aggregation selection", {slot}, e)
        );
      }

      // unlike Attestation, SyncCommitteeSignature could be published asap
      // especially with lodestar, it's very busy at 1/3 of slot
      // see https://github.com/ChainSafe/lodestar/issues/4608
      await Promise.race([
        sleep(this.clock.msToSlotInterval(slot, endOfInterval(SlotInterval.SYNC_ATTESTATION_PROPAGATION)), signal),
        this.emitter.waitForBlockSlot(slot),
      ]);
      this.metrics?.syncCommitteeStepCallProduceMessage.observe(
        this.clock.secFromSlotInterval(slot, endOfInterval(SlotInterval.SYNC_ATTESTATION_PROPAGATION))
      );

      // Step 1. Download, sign and publish an `SyncCommitteeMessage` for each validator.
      //         Differs from AttestationService, `SyncCommitteeMessage` are equal for all
      const beaconBlockRoot = await this.produceAndPublishSyncCommittees(slot, dutiesAtSlot);

      // Step 2. If an attestation was produced, make an aggregate.
      // First, wait until the beginning of SlotInterval.SYNC_AGGREGATE_PROPAGATION
      await sleep(this.clock.msToSlotInterval(slot, SlotInterval.SYNC_AGGREGATE_PROPAGATION), signal);
      this.metrics?.attesterStepCallProduceAggregate.observe(
        this.clock.secFromSlotInterval(slot, SlotInterval.SYNC_AGGREGATE_PROPAGATION)
      );

      // await for all so if the Beacon node is overloaded it auto-throttles
      // TODO: This approach is conservative to reduce the node's load, review
      const dutiesBySubcommitteeIndex = groupSyncDutiesBySubcommitteeIndex(dutiesAtSlot);
      await Promise.all(
        Array.from(dutiesBySubcommitteeIndex.entries()).map(async ([subcommitteeIndex, duties]) => {
          if (duties.length === 0) return;
          // Then download, sign and publish a `SignedAggregateAndProof` for each
          // validator that is elected to aggregate for this `slot` and `subcommitteeIndex`.
          await this.produceAndPublishAggregates(slot, subcommitteeIndex, beaconBlockRoot, duties).catch((e: Error) => {
            this.logger.error("Error on SyncCommitteeContribution", {slot, index: subcommitteeIndex}, e);
          });
        })
      );
    } catch (e) {
      this.logger.error("Error on runSyncCommitteeTasks", {slot}, e as Error);
    }
  };

  /**
   * Performs the first step of the attesting process: downloading `SyncCommittee` objects,
   * signing them and returning them to the validator.
   *
   * https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/altair/validator.md#sync-committee-messages
   *
   * Only one `SyncCommittee` is downloaded from the BN. It is then signed by each
   * validator and the list of individually-signed `SyncCommittee` objects is returned to the BN.
   */
  private async produceAndPublishSyncCommittees(slot: Slot, duties: SyncDutyAndProofs[]): Promise<Root> {
    const logCtx = {slot};

    // /eth/v1/beacon/blocks/:blockId/root -> at slot -1

    // Produce one attestation data per slot and subcommitteeIndex
    // Spec: the validator should prepare a SyncCommitteeMessage for the previous slot (slot - 1)
    // as soon as they have determined the head block of slot - 1

    const blockRoot: Uint8Array =
      this.chainHeaderTracker.getCurrentChainHead(slot) ??
      (await this.api.beacon.getBlockRoot({blockId: "head"})).value().root;

    const signatures: altair.SyncCommitteeMessage[] = [];

    await Promise.all(
      duties.map(async ({duty}) => {
        const logCtxValidator = {...logCtx, validatorIndex: duty.validatorIndex};
        try {
          signatures.push(
            await this.validatorStore.signSyncCommitteeSignature(duty.pubkey, duty.validatorIndex, slot, blockRoot)
          );
          this.logger.debug("Signed SyncCommitteeMessage", logCtxValidator);
        } catch (e) {
          this.logger.error("Error signing SyncCommitteeMessage", logCtxValidator, e as Error);
        }
      })
    );

    // by default we want to submit SyncCommitteeSignature asap after we receive block
    // provide a delay option just in case any client implementation validate the existence of block in
    // SyncCommitteeSignature gossip validation.
    const msToOneIntervalFromSlot = this.clock.msToSlotInterval(
      slot,
      endOfInterval(SlotInterval.SYNC_ATTESTATION_PROPAGATION)
    );
    const afterBlockDelayMs = 1000 * this.clock.secondsPerSlot * (this.opts?.scAfterBlockDelaySlotFraction ?? 0);
    const toDelayMs = Math.min(msToOneIntervalFromSlot, afterBlockDelayMs);
    if (toDelayMs > 0) {
      await sleep(toDelayMs);
    }

    this.metrics?.syncCommitteeStepCallPublishMessage.observe(
      this.clock.secFromSlotInterval(slot, endOfInterval(SlotInterval.SYNC_ATTESTATION_PROPAGATION))
    );

    if (signatures.length > 0) {
      try {
        (await this.api.beacon.submitPoolSyncCommitteeSignatures({signatures})).assertOk();
        this.logger.info("Published SyncCommitteeMessage", {...logCtx, count: signatures.length});
        this.metrics?.publishedSyncCommitteeMessage.inc(signatures.length);
      } catch (e) {
        this.logger.error("Error publishing SyncCommitteeMessage", logCtx, e as Error);
      }
    }

    return blockRoot;
  }

  /**
   * Performs the second step of the attesting process: downloading an aggregated `SyncCommittee`,
   * converting it into a `SignedAggregateAndProof` and returning it to the BN.
   *
   * https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/altair/validator.md#sync-committee-contributions
   *
   * Only one aggregated `SyncCommittee` is downloaded from the BN. It is then signed
   * by each validator and the list of individually-signed `SignedAggregateAndProof` objects is
   * returned to the BN.
   */
  private async produceAndPublishAggregates(
    slot: Slot,
    subcommitteeIndex: CommitteeIndex,
    beaconBlockRoot: Root,
    duties: SubcommitteeDuty[]
  ): Promise<void> {
    const logCtx = {slot, index: subcommitteeIndex};

    // No validator is aggregator, skip
    if (duties.every(({selectionProof}) => selectionProof === null)) {
      return;
    }

    this.logger.verbose("Producing SyncCommitteeContribution", logCtx);
    const res = await this.api.validator.produceSyncCommitteeContribution({slot, subcommitteeIndex, beaconBlockRoot});

    const signedContributions: altair.SignedContributionAndProof[] = [];

    await Promise.all(
      duties.map(async ({duty, selectionProof}) => {
        const logCtxValidator = {...logCtx, validatorIndex: duty.validatorIndex};
        try {
          // Produce signed contributions only for validators that are subscribed aggregators.
          if (selectionProof !== null) {
            signedContributions.push(
              await this.validatorStore.signContributionAndProof(duty, selectionProof, res.value())
            );
            this.logger.debug("Signed SyncCommitteeContribution", logCtxValidator);
          }
        } catch (e) {
          this.logger.error("Error signing SyncCommitteeContribution", logCtxValidator, e as Error);
        }
      })
    );

    this.metrics?.syncCommitteeStepCallPublishAggregate.observe(
      this.clock.secFromSlotInterval(slot, SlotInterval.SYNC_AGGREGATE_PROPAGATION)
    );

    if (signedContributions.length > 0) {
      try {
        (
          await this.api.validator.publishContributionAndProofs({contributionAndProofs: signedContributions})
        ).assertOk();
        this.logger.info("Published SyncCommitteeContribution", {...logCtx, count: signedContributions.length});
        this.metrics?.publishedSyncCommitteeContribution.inc(signedContributions.length);
      } catch (e) {
        this.logger.error("Error publishing SyncCommitteeContribution", logCtx, e as Error);
      }
    }
  }

  /**
   * Performs additional sync committee contribution tasks required if validator is part of distributed cluster
   *
   * 1. Exchange partial for combined selection proofs
   * 2. Determine validators that should produce sync committee contribution
   * 3. Mutate duty objects to set selection proofs for aggregators
   *
   * See https://docs.google.com/document/d/1q9jOTPcYQa-3L8luRvQJ-M0eegtba4Nmon3dpO79TMk/mobilebasic
   */
  private async runDistributedAggregationSelectionTasks(
    duties: SyncDutyAndProofs[],
    slot: number,
    signal: AbortSignal
  ): Promise<void> {
    const partialSelections: routes.validator.SyncCommitteeSelection[] = [];

    for (const {duty, selectionProofs} of duties) {
      const validatorSelections: routes.validator.SyncCommitteeSelection[] = selectionProofs.map(
        ({subcommitteeIndex, partialSelectionProof}) => ({
          validatorIndex: duty.validatorIndex,
          slot,
          subcommitteeIndex,
          selectionProof: partialSelectionProof as BLSSignature,
        })
      );
      partialSelections.push(...validatorSelections);
    }

    this.logger.debug("Submitting partial sync committee selection proofs", {slot, count: partialSelections.length});

    const res = await Promise.race([
      this.api.validator.submitSyncCommitteeSelections({selections: partialSelections}),
      // Exit sync committee contributions flow if there is no response after SlotInterval.SYNC_COMMITTEE_SELECTION of slot.
      // This is in contrast to attestations aggregations flow which is already exited at 1/3 of the slot
      // because for sync committee is not required to resubscribe to subnets as beacon node will assume
      // validator always aggregates. This allows us to wait until we have to produce sync committee contributions.
      // Note that the sync committee contributions flow is not explicitly exited but rather will be skipped
      // due to the fact that calculation of `is_sync_committee_aggregator` in SyncCommitteeDutiesService is not done
      // and selectionProof is set to null, meaning no validator will be considered an aggregator.
      sleep(this.clock.msToSlotInterval(slot, endOfInterval(SlotInterval.SYNC_COMMITTEE_SELECTION)), signal),
    ]);

    if (!res) {
      throw new Error("Failed to receive combined selection proofs before 2/3 of slot");
    }

    const combinedSelections = res.value();
    this.logger.debug("Received combined sync committee selection proofs", {slot, count: combinedSelections.length});

    for (const dutyAndProofs of duties) {
      const {validatorIndex, subnets} = dutyAndProofs.duty;

      for (const subnet of subnets) {
        const logCtxValidator = {slot, index: subnet, validatorIndex};

        const combinedSelection = combinedSelections.find(
          (s) => s.validatorIndex === validatorIndex && s.slot === slot && s.subcommitteeIndex === subnet
        );

        if (!combinedSelection) {
          this.logger.warn("Did not receive combined sync committee selection proof", logCtxValidator);
          continue;
        }

        const isAggregator = isSyncCommitteeAggregator(combinedSelection.selectionProof);

        if (isAggregator) {
          const selectionProofObject = dutyAndProofs.selectionProofs.find((p) => p.subcommitteeIndex === subnet);
          if (selectionProofObject) {
            // Update selection proof by mutating proof objects in duty object
            selectionProofObject.selectionProof = combinedSelection.selectionProof;
          }
        }
      }
    }
  }
}
