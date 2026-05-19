import {ApiClient, routes} from "@lodestar/api";
import {ChainForkConfig} from "@lodestar/config";
import {isForkPostFulu} from "@lodestar/params";
import {computeEpochAtSlot, computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {BLSPubkey, Epoch, RootHex, Slot} from "@lodestar/types";
import {sleep, toPubkeyHex} from "@lodestar/utils";
import {Metrics} from "../metrics.js";
import {PubkeyHex} from "../types.js";
import {IClock, LoggerVc, differenceHex} from "../util/index.js";
import {ValidatorStore} from "./validatorStore.js";

/**
 * Epoch-boundary poll offset (~1s relative to the next slot) for next-epoch proposer duties.
 * Pre-Fulu it is applied ~1s *before* the boundary; post-Gloas the same offset is mirrored
 * to ~1s *after* the boundary. See `pollBeaconProposersNextEpochs`.
 */
// TODO: change to 8333 (5/6 of slot) to do it 2s before the next epoch
// once we have some improvement on epoch transition time
// see https://github.com/ChainSafe/lodestar/issues/5792#issuecomment-1647457442
const BLOCK_DUTIES_LOOKAHEAD_BPS = 9167;
/** Only retain `HISTORICAL_DUTIES_EPOCHS` duties prior to the current epoch */
const HISTORICAL_DUTIES_EPOCHS = 2;
// Re-declaring to not have to depend on `lodestar-params` just for this 0
const GENESIS_EPOCH = 0;
export const GENESIS_SLOT = 0;

export type BlockDutyAtEpoch = {dependentRoot: RootHex; data: routes.validator.ProposerDuty[]};
type NotifyBlockProductionFn = (slot: Slot, proposers: BLSPubkey[]) => void;

export class BlockDutiesService {
  /** Notify the block service if it should produce a block. */
  private notifyBlockProductionFn: NotifyBlockProductionFn = () => {};
  /** Maps an epoch to all *local* proposers in this epoch. Notably, this does not contain
      proposals for any validators which are not registered locally. */
  private readonly proposers = new Map<Epoch, BlockDutyAtEpoch>();

  constructor(
    private readonly config: ChainForkConfig,
    private readonly logger: LoggerVc,
    private readonly api: ApiClient,
    private readonly clock: IClock,
    private readonly validatorStore: ValidatorStore,
    private readonly metrics: Metrics | null
  ) {
    // TODO: Instead of polling every CLOCK_SLOT, poll every CLOCK_EPOCH and track re-org events
    //       only then re-fetch the block duties. Make sure most clients (including Lodestar)
    //       properly emit the re-org event
    clock.runEverySlot(this.runBlockDutiesTask);

    if (metrics) {
      metrics.proposerDutiesEpochCount.addCollect(() => {
        metrics.proposerDutiesEpochCount.set(this.proposers.size);
      });
    }
  }

  /**
   * Late-bind the production callback. Allows the duties service to be constructed
   * before the consumer that handles proposal production.
   */
  setNotifyBlockProductionFn(notifyBlockProductionFn: NotifyBlockProductionFn): void {
    this.notifyBlockProductionFn = notifyBlockProductionFn;
  }

  /**
   * Returns the pubkeys of the validators which are assigned to propose in the given slot.
   *
   * It is possible that multiple validators have an identical proposal slot, however that is
   * likely the result of heavy forking (lol) or inconsistent beacon node connections.
   */
  getblockProposersAtSlot(slot: Slot): BLSPubkey[] {
    const epoch = computeEpochAtSlot(slot);
    const publicKeys = new Map<string, BLSPubkey>(); // pseudo-HashSet of Buffers

    const dutyAtEpoch = this.proposers.get(epoch);
    if (dutyAtEpoch) {
      for (const proposer of dutyAtEpoch.data) {
        if (proposer.slot === slot) {
          publicKeys.set(toPubkeyHex(proposer.pubkey), proposer.pubkey);
        }
      }
    }

    return Array.from(publicKeys.values());
  }

  /**
   * Returns the cached `{dependentRoot, data}` entry for `epoch`, or `undefined` if duties
   * for that epoch are not yet known. Consumers can detect a proposer-shuffling change
   * (e.g. after a reorg) by observing a different `dependentRoot` than the one they last
   * read for the same epoch.
   */
  getProposersAtEpoch(epoch: Epoch): BlockDutyAtEpoch | undefined {
    return this.proposers.get(epoch);
  }

  removeDutiesForKey(pubkey: PubkeyHex): void {
    for (const blockDutyAtEpoch of this.proposers.values()) {
      blockDutyAtEpoch.data = blockDutyAtEpoch.data.filter((proposer) => {
        return toPubkeyHex(proposer.pubkey) !== pubkey;
      });
    }
  }

  private runBlockDutiesTask = async (slot: Slot, signal: AbortSignal): Promise<void> => {
    try {
      if (slot < 0) {
        // Before genesis, fetch the genesis duties but don't notify block production
        // Only fetch duties once since there is not possible to re-org. TODO: Review
        if (!this.proposers.has(GENESIS_EPOCH)) {
          await this.pollBeaconProposers(GENESIS_EPOCH);
        }
      } else {
        await this.pollBeaconProposersAndNotify(slot, signal);
      }
    } catch (e) {
      this.logger.error("Error on pollBeaconProposers", {}, e as Error);
    } finally {
      this.pruneOldDuties(computeEpochAtSlot(slot));
    }
  };

  /**
   * Download the proposer duties for the current epoch and store them in `this.proposers`.
   * If there are any proposer for this slot, send out a notification to the block proposers.
   *
   * ## Note
   *
   * This function will potentially send *two* notifications to the `BlockService`; it will send a
   * notification initially, then it will download the latest duties and send a *second* notification
   * if those duties have changed. This behaviour simultaneously achieves the following:
   *
   * 1. Block production can happen immediately and does not have to wait for the proposer duties to
   *    download.
   * 2. We won't miss a block if the duties for the current slot happen to change with this poll.
   *
   * This sounds great, but is it safe? Firstly, the additional notification will only contain block
   * producers that were not included in the first notification. This should be safety enough.
   * However, we also have the slashing protection as a second line of defense. These two factors
   * provide an acceptable level of safety.
   *
   * Pre-Fulu only: since proposer shuffling has a 0-epoch look-ahead (i.e., no look-ahead),
   * it's very likely that a proposal for the first slot of the epoch will need to go through
   * the slow path every time. I.e., the proposal will only happen after we've been able to
   * download and process the duties from the BN. This means it is very important to ensure this
   * function is as fast as possible.
   *   - Starting from Jul 2023, we poll proposers 1s before the next epoch thanks to PrepareNextSlotScheduler
   * usually finishes in 3s.
   * Post-Fulu the proposer lookahead is deterministic and known a full epoch ahead, so next-epoch
   * duties are polled early/throughout the epoch (see `pollBeaconProposersNextEpochs`) and the
   * first-slot-of-epoch slow-path penalty no longer applies.
   */
  private async pollBeaconProposersAndNotify(currentSlot: Slot, signal: AbortSignal): Promise<void> {
    const nextEpoch = computeEpochAtSlot(currentSlot) + 1;
    this.pollBeaconProposersNextEpochs(currentSlot, nextEpoch, signal).catch((e) => {
      this.logger.error("Error on pollBeaconProposersNextEpochs", {}, e);
    });

    // Notify the block proposal service for any proposals that we have in our cache.
    const initialBlockProposers = this.getblockProposersAtSlot(currentSlot);
    if (initialBlockProposers.length > 0) {
      this.notifyBlockProductionFn(currentSlot, initialBlockProposers);
    }

    // Poll proposers again for the same slot
    await this.pollBeaconProposers(computeEpochAtSlot(currentSlot));

    // Compute the block proposers for this slot again, now that we've received an update from the BN.
    //
    // Then, compute the difference between these two sets to obtain a set of block proposers
    // which were not included in the initial notification to the `BlockService`.
    const newBlockProducers = this.getblockProposersAtSlot(currentSlot);
    const additionalBlockProducers = differenceHex(initialBlockProposers, newBlockProducers);

    // If there are any new proposers for this slot, send a notification so they produce a block.
    //
    // See the function-level documentation for more reasoning about this behaviour.
    if (additionalBlockProducers.length > 0) {
      this.notifyBlockProductionFn(currentSlot, additionalBlockProducers);
      this.logger.debug("Detected new block proposer", {currentSlot});
      this.metrics?.newProposalDutiesDetected.inc();
    }
  }

  /**
   * Pre-fulu: this is to avoid some delay on the first slot of the epoch when validators have proposal duties.
   * See https://github.com/ChainSafe/lodestar/issues/5792
   * Post-fulu:
   *   - if it's mid epoch, poll beacon proposers for the next epoch
   *   - if it's end of epoch, poll proposers for nextEpoch and (next Epoch + 1)
   */
  private async pollBeaconProposersNextEpochs(currentSlot: Slot, nextEpoch: Epoch, signal: AbortSignal): Promise<void> {
    const nextSlot = currentSlot + 1;
    // `currentSlot` is the last slot of its epoch ⇒ `nextSlot` starts `nextEpoch`.
    const isEpochBoundary = computeStartSlotAtEpoch(nextEpoch) === nextSlot;
    const lookAheadMs =
      this.config.SLOT_DURATION_MS - this.config.getSlotComponentDurationMs(BLOCK_DUTIES_LOOKAHEAD_BPS);
    const fork = this.config.getForkName(nextSlot);

    if (isForkPostFulu(fork)) {
      if (isEpochBoundary) {
        // Sleep until ~lookAheadMs after the next slot starts so the BN clock is in
        // `nextEpoch` and `nextEpoch + 1` is servable (= the new `currentEpoch + 1`).
        await sleep(this.clock.msToSlot(nextSlot) + lookAheadMs, signal);
        this.logger.debug("Polling proposers for the next 2 epochs", {nextEpoch, currentSlot});
        await this.pollBeaconProposers(nextEpoch);
        await this.pollBeaconProposers(nextEpoch + 1);
        return;
      }

      this.logger.debug("Polling proposers for the next epoch", {nextEpoch, currentSlot});
      await this.pollBeaconProposers(nextEpoch);
      return;
    }

    // Pre-Fulu: 0-epoch lookahead — only the last slot of the epoch matters. Sleep until
    // ~1s before the boundary, then poll the next epoch once.
    if (!isEpochBoundary) {
      return;
    }
    await sleep(this.clock.msToSlot(nextSlot) - lookAheadMs, signal);
    this.logger.debug("Polling proposers for the next epoch", {nextEpoch, currentSlot});
    await this.pollBeaconProposers(nextEpoch);
  }

  private async pollBeaconProposers(epoch: Epoch): Promise<void> {
    // Only download duties and push out additional block production events if we have some validators.
    if (!this.validatorStore.hasSomeValidators()) {
      return;
    }

    // Post-Fulu the proposer dependent root changed (deterministic proposer lookahead)
    const res = isForkPostFulu(this.config.getForkName(computeStartSlotAtEpoch(epoch)))
      ? await this.api.validator.getProposerDutiesV2({epoch})
      : await this.api.validator.getProposerDuties({epoch});
    const proposerDuties = res.value();
    const {dependentRoot} = res.meta();
    const relevantDuties = proposerDuties.filter((duty) => {
      const pubkeyHex = toPubkeyHex(duty.pubkey);
      return this.validatorStore.hasVotingPubkey(pubkeyHex) && this.validatorStore.isDoppelgangerSafe(pubkeyHex);
    });

    this.logger.debug("Downloaded proposer duties", {epoch, dependentRoot, count: relevantDuties.length});

    const prior = this.proposers.get(epoch);
    this.proposers.set(epoch, {dependentRoot, data: relevantDuties});

    if (prior && prior.dependentRoot !== dependentRoot) {
      this.metrics?.proposerDutiesReorg.inc();
      this.logger.warn("Proposer duties re-org. This may happen from time to time", {
        priorDependentRoot: prior.dependentRoot,
        dependentRoot,
      });
    }
  }

  /** Run once per epoch to prune `this.proposers` map */
  private pruneOldDuties(currentEpoch: Epoch): void {
    for (const epoch of this.proposers.keys()) {
      if (epoch + HISTORICAL_DUTIES_EPOCHS < currentEpoch) {
        this.proposers.delete(epoch);
      }
    }
  }
}
