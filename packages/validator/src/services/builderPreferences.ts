import {ApiClient, routes} from "@lodestar/api";
import {ChainForkConfig} from "@lodestar/config";
import {SLOTS_PER_EPOCH, isForkPostGloas} from "@lodestar/params";
import {IClock, computeEpochAtSlot} from "@lodestar/state-transition";
import {Epoch, RootHex, Slot} from "@lodestar/types";
import {toPubkeyHex} from "@lodestar/utils";
import {Metrics} from "../metrics.js";
import {LoggerVc} from "../util/index.js";
import {BlockDutiesService} from "./blockDuties.js";
import {ValidatorStore} from "./validatorStore.js";

/**
 * Submit a proposer's builder preferences this many slots before the proposal slot.
 * Same pacing as `ProposerPreferencesService`, builders must have the preferences
 * before the bid request arrives at proposal time.
 */
const SUBMIT_BEFORE_PROPOSAL_SLOTS = Math.floor(SLOTS_PER_EPOCH / 4);

/** Per-epoch tracking of preferences already submitted under the current dependent_root. */
type SubmittedAtEpoch = {dependentRoot: RootHex; slots: Set<Slot>};

/**
 * Signs and submits builder preferences for any local validator that will propose within the
 * next `SUBMIT_BEFORE_PROPOSAL_SLOTS` and has external builders configured. Signing the request
 * auths here also pre-fills the auth cache used at proposal time.
 *
 * The beacon node submits each entry to the builder at the entry's url. Re-submits automatically
 * when the proposer dependent root for an epoch shifts (e.g. after a reorg) since the proposer
 * for a slot may have changed.
 */
export class BuilderPreferencesService {
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
    clock.runEverySlot(this.runBuilderPreferencesTask);
  }

  private runBuilderPreferencesTask = async (slot: Slot): Promise<void> => {
    // Start running once the submission window (`slot + SUBMIT_BEFORE_PROPOSAL_SLOTS`) reaches
    // Gloas, i.e. already in the epoch before the fork. This allows builders to prepare and
    // submit bids for the first Gloas slots.
    if (!isForkPostGloas(this.config.getForkName(slot + SUBMIT_BEFORE_PROPOSAL_SLOTS))) {
      return;
    }

    const currentEpoch = computeEpochAtSlot(slot);
    const entries: routes.validator.BuilderPreferencesEntry[] = [];
    // Track which `(submission, slot)` pairs are pending an API submission so we can mark
    // them only after the network call succeeds. Marking before would silently drop a
    // preference on transient API failure (no retry until dependent_root shifts).
    const pending: {submission: SubmittedAtEpoch; slot: Slot}[] = [];

    for (const epoch of [currentEpoch, currentEpoch + 1]) {
      const dutiesAtEpoch = this.blockDutiesService.getProposersAtEpoch(epoch);
      if (!dutiesAtEpoch) continue;

      // Reset submission tracking if the dependent root for this epoch has shifted
      // (e.g. due to a reorg). The proposer for a slot may have changed.
      let submission = this.submitted.get(epoch);
      if (submission === undefined || submission.dependentRoot !== dutiesAtEpoch.dependentRoot) {
        if (submission !== undefined) {
          this.logger.info("Proposer-shuffling dependent root shifted; resubmitting builder preferences", {
            epoch,
            priorDependentRoot: submission.dependentRoot,
            dependentRoot: dutiesAtEpoch.dependentRoot,
          });
        }
        submission = {dependentRoot: dutiesAtEpoch.dependentRoot, slots: new Set()};
        this.submitted.set(epoch, submission);
      }

      for (const duty of dutiesAtEpoch.data) {
        if (duty.slot <= slot) continue;
        if (duty.slot > slot + SUBMIT_BEFORE_PROPOSAL_SLOTS) continue;
        if (!isForkPostGloas(this.config.getForkName(duty.slot))) continue;
        if (submission.slots.has(duty.slot)) continue;

        const pubkeyHex = toPubkeyHex(duty.pubkey);
        const {selection} = this.validatorStore.getBuilderSelectionParams(pubkeyHex, duty.slot);
        if (selection === routes.validator.BuilderSelection.ExecutionOnly) continue;

        const builderEntries = this.validatorStore.getResolvedBuilderEntries(pubkeyHex);
        if (builderEntries.length === 0) continue;

        try {
          // Collect entries per duty and only add them to the batch if signing
          // succeeded for all builders, else the duty is retried on the next tick
          const dutyEntries: routes.validator.BuilderPreferencesEntry[] = [];
          for (const entry of builderEntries) {
            const auth = await this.validatorStore.getRequestAuth(duty.pubkey, entry.authData, duty.slot, slot);
            dutyEntries.push({
              proposerPubkey: duty.pubkey,
              url: new Uint8Array(Buffer.from(entry.url, "utf8")),
              auth,
              maxExecutionPayment: entry.maxExecutionPayment,
            });
          }
          entries.push(...dutyEntries);
          pending.push({submission, slot: duty.slot});
        } catch (e) {
          this.logger.error(
            "Error signing builder preferences",
            {slot: duty.slot, validatorIndex: duty.validatorIndex},
            e as Error
          );
        }
      }
    }

    // Prune tracking for past epochs
    for (const epoch of this.submitted.keys()) {
      if (epoch < currentEpoch) {
        this.submitted.delete(epoch);
      }
    }

    if (entries.length === 0) {
      return;
    }

    try {
      (await this.api.validator.submitBuilderPreferences({builderPreferences: entries})).assertOk();
      // Only mark as submitted after the API call succeeds; a thrown error leaves the
      // slot eligible for retry on the next tick.
      for (const {submission, slot: submittedSlot} of pending) {
        submission.slots.add(submittedSlot);
      }
      this.logger.debug("Submitted builder preferences", {count: entries.length});
    } catch (e) {
      this.logger.error("Error submitting builder preferences", {count: entries.length}, e as Error);
    }
  };
}
