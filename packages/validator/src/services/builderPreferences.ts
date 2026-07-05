import {ApiClient, routes} from "@lodestar/api";
import {ChainForkConfig} from "@lodestar/config";
import {SLOTS_PER_EPOCH, isForkPostGloas} from "@lodestar/params";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {Epoch, RootHex, Slot} from "@lodestar/types";
import {toPubkeyHex} from "@lodestar/utils";
import {Metrics} from "../metrics.js";
import {IClock, LoggerVc} from "../util/index.js";
import {BlockDutiesService} from "./blockDuties.js";
import {ValidatorStore} from "./validatorStore.js";

/**
 * Submit a proposer's builder preferences this many slots before the proposal slot.
 * Same pacing as `ProposerPreferencesService`, builders must have the preferences
 * and the beacon node must have the request auths before the bid request at proposal time.
 */
const SUBMIT_BEFORE_PROPOSAL_SLOTS = Math.floor(SLOTS_PER_EPOCH / 4);

/** Per-epoch tracking of preferences already submitted under the current dependent_root. */
type SubmittedAtEpoch = {dependentRoot: RootHex; slots: Set<Slot>};

/**
 * Signs and submits `BuilderPreferencesRequestV1` for any local validator that will propose
 * within the next `SUBMIT_BEFORE_PROPOSAL_SLOTS` and has external builders configured.
 *
 * The beacon node forwards each request to the builder the validator signed over
 * (`auth.message.data`) and caches the auth to authenticate the bid request at proposal time.
 * Re-submits automatically when the proposer dependent root for an epoch shifts (e.g. after
 * a reorg) since the proposer for a slot may have changed.
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
    const submissions: routes.validator.BuilderPreferencesSubmissionList = [];
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
        const {selection} = this.validatorStore.getBuilderSelectionParams(pubkeyHex);
        if (selection === routes.validator.BuilderSelection.ExecutionOnly) continue;

        const builders = this.validatorStore.getRegisteredBuilders(pubkeyHex);
        if (builders.length === 0) continue;

        try {
          // Collect submissions per duty and only add them to the batch if signing
          // succeeded for all builders, else the duty is retried on the next tick
          const dutySubmissions: routes.validator.BuilderPreferencesSubmissionList = [];
          for (const {url, maxExecutionPayment} of builders) {
            const auth = await this.validatorStore.getRequestAuth(duty.pubkey, url, duty.slot, slot);
            dutySubmissions.push({
              validatorPubkey: duty.pubkey,
              request: {preferences: {maxExecutionPayment}, auth},
            });
          }
          submissions.push(...dutySubmissions);
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

    if (submissions.length === 0) {
      return;
    }

    try {
      await this.api.validator.submitBuilderPreferences({submissions});
      // Only mark as submitted after the API call succeeds; a thrown error leaves the
      // slot eligible for retry on the next tick.
      for (const {submission, slot: submittedSlot} of pending) {
        submission.slots.add(submittedSlot);
      }
      this.logger.debug("Submitted builder preferences", {count: submissions.length});
    } catch (e) {
      this.logger.error("Error submitting builder preferences", {count: submissions.length}, e as Error);
    }
  };
}
