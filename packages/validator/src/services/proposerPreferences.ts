import {ApiClient} from "@lodestar/api";
import {ChainForkConfig} from "@lodestar/config";
import {SLOTS_PER_EPOCH, isForkPostGloas} from "@lodestar/params";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {Epoch, RootHex, Slot, gloas} from "@lodestar/types";
import {fromHex, toPubkeyHex} from "@lodestar/utils";
import {Metrics} from "../metrics.js";
import {IClock, LoggerVc} from "../util/index.js";
import {BlockDutiesService} from "./blockDuties.js";
import {ValidatorStore} from "./validatorStore.js";

/**
 * Submit a proposer's `SignedProposerPreferences` this many slots before the proposal slot.
 *
 * Earlier submission means more reorg-triggered resubmits (and gossip flood); later
 * submission risks missing the bid-auction window for this proposal slot. The bid for
 * slot S typically arrives at slot S-1, so we want preferences propagated to the network
 * and consumed by builders before then. SLOTS_PER_EPOCH / 4 (8 slots @ 32 SPE, ~96s @ 12s
 * slots) gives ample margin while bounding redundant resubmits.
 */
const SUBMIT_BEFORE_PROPOSAL_SLOTS = Math.floor(SLOTS_PER_EPOCH / 4);

/** Per-epoch tracking of preferences already submitted under the current dependent_root. */
type SubmittedAtEpoch = {dependentRoot: RootHex; slots: Set<Slot>};

/**
 * Signs and submits `SignedProposerPreferences` for any local validator that will propose
 * within the next `SUBMIT_BEFORE_PROPOSAL_SLOTS`. Re-submits automatically when the proposer
 * dependent root for an epoch shifts (e.g. after a reorg) — detected by comparing the cached
 * `dependentRoot` reported by `BlockDutiesService` against the one we last submitted under.
 *
 * Proposers should broadcast their preferences before the fork so the proposer preference caches
 * of beacon nodes and builders are warm for the first Gloas slots. We start submitting
 * as soon as a duty's proposal slot is in Gloas, which is up to `SUBMIT_BEFORE_PROPOSAL_SLOTS`
 * before the fork, so only the first few Gloas slots are affected by this pre-fork submission.
 */
export class ProposerPreferencesService {
  private readonly submitted = new Map<Epoch, SubmittedAtEpoch>();

  constructor(
    private readonly config: ChainForkConfig,
    private readonly logger: LoggerVc,
    private readonly api: ApiClient,
    clock: IClock,
    private readonly validatorStore: ValidatorStore,
    private readonly blockDutiesService: BlockDutiesService,
    _metrics: Metrics | null
  ) {
    clock.runEverySlot(this.runProposerPreferencesTask);
    clock.runEveryEpoch(this.pruneSubmitted);
  }

  private runProposerPreferencesTask = async (slot: Slot): Promise<void> => {
    // Start running once the submission window (`slot + SUBMIT_BEFORE_PROPOSAL_SLOTS`) reaches
    // Gloas, i.e. already in the epoch before the fork. This allows builders to prepare and
    // submit bids for the first Gloas slots.
    if (!isForkPostGloas(this.config.getForkName(slot + SUBMIT_BEFORE_PROPOSAL_SLOTS))) {
      return;
    }

    const currentEpoch = computeEpochAtSlot(slot);
    const batch: gloas.SignedProposerPreferences[] = [];
    // Track which `(submission, slot)` pairs are pending an API submission so we can mark
    // them only after the network call succeeds. Marking before would silently drop a
    // preference on transient API failure (no retry until dependent_root shifts).
    const pending: {submission: SubmittedAtEpoch; slot: Slot}[] = [];

    for (const epoch of [currentEpoch, currentEpoch + 1]) {
      const dutiesAtEpoch = this.blockDutiesService.getProposersAtEpoch(epoch);
      if (!dutiesAtEpoch) continue;

      // Reset submission tracking if the dependent root for this epoch has shifted
      // (e.g. due to a reorg). Any previously-submitted preferences are now stale.
      let submission = this.submitted.get(epoch);
      if (submission === undefined || submission.dependentRoot !== dutiesAtEpoch.dependentRoot) {
        if (submission !== undefined) {
          this.logger.info("Proposer-shuffling dependent root shifted; resubmitting preferences", {
            epoch,
            priorDependentRoot: submission.dependentRoot,
            dependentRoot: dutiesAtEpoch.dependentRoot,
          });
        }
        submission = {dependentRoot: dutiesAtEpoch.dependentRoot, slots: new Set()};
        this.submitted.set(epoch, submission);
      }

      const dependentRootBytes = fromHex(dutiesAtEpoch.dependentRoot);

      for (const duty of dutiesAtEpoch.data) {
        if (duty.slot <= slot) continue;
        if (duty.slot > slot + SUBMIT_BEFORE_PROPOSAL_SLOTS) continue;
        if (!isForkPostGloas(this.config.getForkName(duty.slot))) continue;
        if (submission.slots.has(duty.slot)) continue;

        try {
          const pubkeyHex = toPubkeyHex(duty.pubkey);
          const signed = await this.validatorStore.signProposerPreferences(
            duty,
            dependentRootBytes,
            this.validatorStore.getFeeRecipient(pubkeyHex),
            this.validatorStore.getGasLimit(pubkeyHex),
            slot
          );
          batch.push(signed);
          pending.push({submission, slot: duty.slot});
        } catch (e) {
          this.logger.error(
            "Error signing proposer preferences",
            {slot: duty.slot, validatorIndex: duty.validatorIndex},
            e as Error
          );
        }
      }
    }

    if (batch.length === 0) {
      return;
    }

    try {
      await this.api.validator.submitProposerPreferences({signedProposerPreferences: batch});
      // Only mark as submitted after the API call succeeds; a thrown error leaves the
      // slot eligible for retry on the next tick.
      for (const {submission, slot: submittedSlot} of pending) {
        submission.slots.add(submittedSlot);
      }
      this.logger.debug("Submitted signed proposer preferences", {count: batch.length});
    } catch (e) {
      this.logger.error("Error submitting signed proposer preferences", {count: batch.length}, e as Error);
    }
  };

  /** Drop tracking for past epochs; only currentEpoch and currentEpoch + 1 are ever processed. */
  private pruneSubmitted = async (epoch: Epoch): Promise<void> => {
    for (const trackedEpoch of this.submitted.keys()) {
      if (trackedEpoch < epoch) {
        this.submitted.delete(trackedEpoch);
      }
    }
  };
}
