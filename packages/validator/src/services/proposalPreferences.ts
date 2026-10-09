import {ApiClient, routes} from "@lodestar/api";
import {ChainForkConfig} from "@lodestar/config";
import {SLOTS_PER_EPOCH, isForkPostGloas} from "@lodestar/params";
import {IClock, computeEpochAtSlot} from "@lodestar/state-transition";
import {Epoch, RootHex, Slot, gloas} from "@lodestar/types";
import {fromHex, toPubkeyHex} from "@lodestar/utils";
import {Metrics} from "../metrics.js";
import {LoggerVc} from "../util/index.js";
import {BlockDutiesService} from "./blockDuties.js";
import {ValidatorStore} from "./validatorStore.js";

/**
 * Submit the preferences of a proposal this many slots before the proposal slot.
 *
 * Earlier submission means more reorg-triggered resubmits (and gossip flood); later
 * submission risks missing the bid-auction window for this proposal slot. The bid for
 * slot S typically arrives at slot S-1, so we want preferences propagated to the network
 * and consumed by builders before then. SLOTS_PER_EPOCH / 4 (8 slots @ 32 SPE, ~96s @ 12s
 * slots) gives ample margin while bounding redundant resubmits.
 */
const SUBMIT_BEFORE_PROPOSAL_SLOTS = Math.floor(SLOTS_PER_EPOCH / 4);

/** Per-epoch tracking of preferences already submitted under the current dependent_root. */
type SubmittedAtEpoch = {dependentRoot: RootHex; proposerSlots: Set<Slot>; builderSlots: Set<Slot>};
type PendingSubmission = {submission: SubmittedAtEpoch; slot: Slot};

/**
 * Signs and submits the preferences of local proposals within the next `SUBMIT_BEFORE_PROPOSAL_SLOTS`:
 * the `SignedProposerPreferences` the beacon node broadcasts on gossip and the builder preferences
 * it forwards to the builders configured for the validator. Signing the builder request auths here
 * also pre-fills the auth cache used at proposal time.
 *
 * Re-submits automatically when the proposer dependent root for an epoch shifts (e.g. after a reorg)
 * since the proposer for a slot may have changed. Detected by comparing the cached `dependentRoot`
 * reported by `BlockDutiesService` against the one we last submitted under.
 *
 * Proposers should broadcast their preferences before the fork so the proposer preference caches
 * of beacon nodes and builders are warm for the first Gloas slots. We start submitting
 * as soon as a duty's proposal slot is in Gloas, which is up to `SUBMIT_BEFORE_PROPOSAL_SLOTS`
 * before the fork, so only the first few Gloas slots are affected by this pre-fork submission.
 */
export class ProposalPreferencesService {
  private readonly submitted = new Map<Epoch, SubmittedAtEpoch>();
  private activeScheduledGasLimit: number | undefined;

  constructor(
    private readonly config: ChainForkConfig,
    private readonly logger: LoggerVc,
    private readonly api: ApiClient,
    clock: IClock,
    private readonly validatorStore: ValidatorStore,
    private readonly blockDutiesService: BlockDutiesService,
    _metrics: Metrics | null
  ) {
    clock.runEverySlot(this.runPreferencesTask);
    clock.runEveryEpoch(this.runEveryEpochTask);
  }

  private runPreferencesTask = async (slot: Slot): Promise<void> => {
    // Start running once the submission window (`slot + SUBMIT_BEFORE_PROPOSAL_SLOTS`) reaches
    // Gloas, i.e. already in the epoch before the fork. This allows builders to prepare and
    // submit bids for the first Gloas slots.
    if (!isForkPostGloas(this.config.getForkName(slot + SUBMIT_BEFORE_PROPOSAL_SLOTS))) {
      return;
    }

    const currentEpoch = computeEpochAtSlot(slot);
    const proposerPreferences: gloas.SignedProposerPreferences[] = [];
    const builderPreferences: routes.validator.BuilderPreferencesEntry[] = [];
    // Track which `(submission, slot)` pairs are pending an API submission so we can mark
    // them only after the network call succeeds. Marking before would silently drop a
    // preference on transient API failure (no retry until dependent_root shifts).
    const pendingProposerPreferences: PendingSubmission[] = [];
    const pendingBuilderPreferences: PendingSubmission[] = [];

    for (const epoch of [currentEpoch, currentEpoch + 1]) {
      const dutiesAtEpoch = this.blockDutiesService.getProposersAtEpoch(epoch);
      if (!dutiesAtEpoch) continue;

      const submission = this.getSubmissionAtEpoch(epoch, dutiesAtEpoch.dependentRoot);

      for (const duty of dutiesAtEpoch.data) {
        if (duty.slot <= slot) continue;
        if (duty.slot > slot + SUBMIT_BEFORE_PROPOSAL_SLOTS) continue;
        if (!isForkPostGloas(this.config.getForkName(duty.slot))) continue;

        if (!submission.proposerSlots.has(duty.slot)) {
          const signed = await this.signProposerPreferences(duty, submission.dependentRoot, slot);
          if (signed !== null) {
            proposerPreferences.push(signed);
            pendingProposerPreferences.push({submission, slot: duty.slot});
          }
        }

        if (!submission.builderSlots.has(duty.slot)) {
          const entries = await this.signBuilderPreferences(duty, slot);
          if (entries.length > 0) {
            builderPreferences.push(...entries);
            pendingBuilderPreferences.push({submission, slot: duty.slot});
          }
        }
      }
    }

    await Promise.all([
      this.submitProposerPreferences(proposerPreferences, pendingProposerPreferences),
      this.submitBuilderPreferences(builderPreferences, pendingBuilderPreferences),
    ]);
  };

  private runEveryEpochTask = async (epoch: Epoch): Promise<void> => {
    const scheduledGasLimit = this.config.getScheduledGasLimit(epoch);
    if (scheduledGasLimit !== undefined && scheduledGasLimit !== this.activeScheduledGasLimit) {
      const configuredDefaultGasLimit = this.validatorStore.getConfiguredDefaultGasLimit();
      this.logger.info("Gas limit schedule active", {
        epoch,
        recommendedGasLimit: scheduledGasLimit,
        effectiveDefaultGasLimit: configuredDefaultGasLimit ?? scheduledGasLimit,
        defaultGasLimitSource: configuredDefaultGasLimit === undefined ? "schedule" : "operator",
      });
      this.activeScheduledGasLimit = scheduledGasLimit;
    }

    // Drop tracking for past epochs; only currentEpoch and currentEpoch + 1 are ever processed.
    for (const trackedEpoch of this.submitted.keys()) {
      if (trackedEpoch < epoch) {
        this.submitted.delete(trackedEpoch);
      }
    }
  };

  /** Resets the tracking of `epoch` if the dependent root shifted, previously submitted preferences are stale. */
  private getSubmissionAtEpoch(epoch: Epoch, dependentRoot: RootHex): SubmittedAtEpoch {
    let submission = this.submitted.get(epoch);
    if (submission === undefined || submission.dependentRoot !== dependentRoot) {
      if (submission !== undefined) {
        this.logger.info("Proposer-shuffling dependent root shifted; resubmitting preferences", {
          epoch,
          priorDependentRoot: submission.dependentRoot,
          dependentRoot,
        });
      }
      submission = {dependentRoot, proposerSlots: new Set(), builderSlots: new Set()};
      this.submitted.set(epoch, submission);
    }
    return submission;
  }

  private async signProposerPreferences(
    duty: routes.validator.ProposerDuty,
    dependentRoot: RootHex,
    slot: Slot
  ): Promise<gloas.SignedProposerPreferences | null> {
    try {
      const pubkeyHex = toPubkeyHex(duty.pubkey);
      return await this.validatorStore.signProposerPreferences(
        duty,
        fromHex(dependentRoot),
        this.validatorStore.getFeeRecipient(pubkeyHex),
        this.validatorStore.getGasLimit(pubkeyHex, duty.slot, this.logger),
        slot
      );
    } catch (e) {
      this.logger.error(
        "Error signing proposer preferences",
        {slot: duty.slot, validatorIndex: duty.validatorIndex},
        e as Error
      );
      return null;
    }
  }

  private async signBuilderPreferences(
    duty: routes.validator.ProposerDuty,
    slot: Slot
  ): Promise<routes.validator.BuilderPreferencesEntry[]> {
    const pubkeyHex = toPubkeyHex(duty.pubkey);
    const {selection} = this.validatorStore.getBuilderSelectionParams(pubkeyHex, duty.slot);
    if (selection === routes.validator.BuilderSelection.ExecutionOnly) {
      return [];
    }

    try {
      // Only submit the entries of a proposal if signing succeeded for all of its builders,
      // else the proposal is retried on the next tick
      const entries: routes.validator.BuilderPreferencesEntry[] = [];
      for (const entry of this.validatorStore.getResolvedBuilderEntries(pubkeyHex)) {
        const auth = await this.validatorStore.getBuilderRequestAuth(duty.pubkey, entry.authData, duty.slot, slot);
        entries.push({
          proposerPubkey: duty.pubkey,
          url: new TextEncoder().encode(entry.url),
          auth,
          maxExecutionPayment: entry.maxExecutionPayment,
        });
      }
      return entries;
    } catch (e) {
      this.logger.error(
        "Error signing builder preferences",
        {slot: duty.slot, validatorIndex: duty.validatorIndex},
        e as Error
      );
      return [];
    }
  }

  private async submitProposerPreferences(
    signedProposerPreferences: gloas.SignedProposerPreferences[],
    pending: PendingSubmission[]
  ): Promise<void> {
    if (signedProposerPreferences.length === 0) {
      return;
    }

    try {
      (await this.api.validator.submitProposerPreferences({signedProposerPreferences})).assertOk();
      // Only mark as submitted after the API call succeeds; a thrown error leaves the
      // slot eligible for retry on the next tick.
      for (const {submission, slot} of pending) {
        submission.proposerSlots.add(slot);
      }
      this.logger.debug("Submitted signed proposer preferences", {count: signedProposerPreferences.length});
    } catch (e) {
      this.logger.error(
        "Error submitting signed proposer preferences",
        {count: signedProposerPreferences.length},
        e as Error
      );
    }
  }

  private async submitBuilderPreferences(
    builderPreferences: routes.validator.BuilderPreferencesEntry[],
    pending: PendingSubmission[]
  ): Promise<void> {
    if (builderPreferences.length === 0) {
      return;
    }

    try {
      (await this.api.validator.submitBuilderPreferences({builderPreferences})).assertOk();
      // Only mark as submitted after the API call succeeds; a thrown error, including per-entry
      // failures reported by index, leaves all slots eligible for retry on the next tick.
      // Re-submitting preferences a builder already accepted is harmless.
      for (const {submission, slot} of pending) {
        submission.builderSlots.add(slot);
      }
      this.logger.debug("Submitted builder preferences", {count: builderPreferences.length});
    } catch (e) {
      this.logger.warn("Error submitting builder preferences", {count: builderPreferences.length}, e as Error);
    }
  }
}
