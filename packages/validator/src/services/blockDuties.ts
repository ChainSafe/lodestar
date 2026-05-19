import {ApiClient, routes} from "@lodestar/api";
import {ChainForkConfig} from "@lodestar/config";
import {isForkPostFulu} from "@lodestar/params";
import {computeEpochAtSlot, computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {BLSPubkey, Epoch, RootHex, Slot} from "@lodestar/types";
import {sleep, toPubkeyHex} from "@lodestar/utils";
import {Metrics} from "../metrics.js";
import {PubkeyHex} from "../types.js";
import {IClock, LoggerVc} from "../util/index.js";
import {ChainHeaderTracker, HeadEventData} from "./chainHeaderTracker.js";
import {ValidatorStore} from "./validatorStore.js";

/**
 * Pre-Fulu only: poll next-epoch proposer duties ~1s before the boundary. Post-Fulu the 1-epoch
 * deterministic lookahead lets us pre-fetch via `runEveryEpoch`, so this fast path is unused.
 *
 * Historical context: starting Jul 2023 we poll 1s before the next epoch because
 * `PrepareNextSlotScheduler` (BN-side) usually finishes the upcoming-epoch transition in ~3s,
 * so the proposer-duties query at ~1s pre-boundary lands on a hot cache. See:
 *  - https://github.com/ChainSafe/lodestar/issues/5792
 */
// TODO: change to 8333 (5/6 of slot) to do it 2s before the next epoch
// once we have some improvement on epoch transition time
// see https://github.com/ChainSafe/lodestar/issues/5792#issuecomment-1647457442
// TODO GLOAS: re-evaluate timing — Gloas may want the offset *after* the boundary
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

  /**
   * Tracks which proposer pubkeys we have already notified for the active slot so that
   * a late-arriving cache update (SSE-driven refetch, slow initial poll) only fires
   * `notifyBlockProductionFn` for *newly discovered* proposers, never duplicates.
   */
  private notifiedSlot: Slot = -1;
  private readonly notifiedProposers = new Set<PubkeyHex>();
  /**
   * True once `notifyProposersForSlot` has been invoked for `notifiedSlot`, regardless of
   * whether anything was notified. Any subsequent invocation that finds *new* proposers is
   * therefore a late detection — the signal tracked by `newProposalDutiesDetected`.
   */
  private notifiedSlotInitialPass = false;

  constructor(
    private readonly config: ChainForkConfig,
    private readonly logger: LoggerVc,
    private readonly api: ApiClient,
    private readonly clock: IClock,
    private readonly validatorStore: ValidatorStore,
    chainHeaderTracker: ChainHeaderTracker,
    private readonly metrics: Metrics | null
  ) {
    clock.runEveryEpoch(this.runEveryEpochTask);
    clock.runEverySlot(this.runEverySlotTask);
    chainHeaderTracker.runOnNewHead(this.onNewHead);

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

  /**
   * Baseline per-epoch fetch. Fires at epoch boundaries (and once at startup). Post-Fulu the
   * deterministic 1-epoch lookahead lets us also pre-fetch `epoch + 1`; pre-Fulu the next
   * epoch's dep_root only stabilizes at the boundary and is handled by `runEverySlotTask`.
   *
   * Mid-epoch refreshes (e.g. reorgs) are driven by `onNewHead` instead of polling every slot.
   */
  private runEveryEpochTask = async (epoch: Epoch): Promise<void> => {
    try {
      if (epoch < GENESIS_EPOCH) {
        // Pre-genesis: prime the genesis-epoch duties exactly once so the slot-0 proposer
        // doesn't have to wait on a cold cache. Only fetch once since a pre-genesis re-org
        // is not possible. TODO: Review.
        if (!this.proposers.has(GENESIS_EPOCH)) {
          await this.pollBeaconProposers(GENESIS_EPOCH);
        }
        return;
      }

      await this.pollBeaconProposers(epoch);

      const nextEpoch = epoch + 1;
      if (isForkPostFulu(this.config.getForkName(computeStartSlotAtEpoch(nextEpoch)))) {
        await this.pollBeaconProposers(nextEpoch);
      }
    } catch (e) {
      this.logger.error("Error on runEveryEpochTask", {epoch}, e as Error);
    } finally {
      this.pruneOldDuties(Math.max(epoch, GENESIS_EPOCH));
    }
  };

  /**
   * Slot-tick handler. Notifies block production for cached proposers in this slot, and on
   * the last slot of a pre-Fulu epoch schedules the boundary fetch for `nextEpoch` duties.
   * Reorg detection is handled by `onNewHead`, so this task does not re-poll on every slot.
   */
  private runEverySlotTask = async (slot: Slot, signal: AbortSignal): Promise<void> => {
    try {
      if (slot < GENESIS_SLOT) {
        return;
      }

      this.notifyProposersForSlot(slot);

      const nextEpoch = computeEpochAtSlot(slot) + 1;
      const isLastSlotOfEpoch = computeStartSlotAtEpoch(nextEpoch) === slot + 1;
      if (isLastSlotOfEpoch && !isForkPostFulu(this.config.getForkName(slot + 1))) {
        // Pre-Fulu: 0-epoch proposer lookahead, so the next-epoch dep_root only becomes stable
        // as the last block of the current epoch lands. Sleep until ~1s before the boundary
        // then fetch — same timing as before this refactor.
        this.pollBeaconProposersBeforeBoundary(slot, nextEpoch, signal).catch((e) => {
          this.logger.error("Error on pollBeaconProposersBeforeBoundary", {nextEpoch}, e);
        });
      }
    } catch (e) {
      this.logger.error("Error on runEverySlotTask", {slot}, e as Error);
    }
  };

  /**
   * SSE head-event handler. The beacon-API `head` event carries attester-duty dep_roots,
   * which coincide with the proposer dep_roots at a fork-dependent offset:
   *
   *   Pre-Fulu  (proposer dep_root(E) = block@startSlot(E) - 1):
   *     currentDutyDependentRoot  ≡ proposer_dep_root(currentEpoch)
   *     (next-epoch proposer dep_root is not exposed; pre-Fulu falls back to the
   *      `runEverySlotTask` boundary poll.)
   *
   *   Post-Fulu (proposer dep_root(E) = block@startSlot(E - 1) - 1, EIP-7917):
   *     previousDutyDependentRoot ≡ proposer_dep_root(currentEpoch)
   *     currentDutyDependentRoot  ≡ proposer_dep_root(nextEpoch)
   *
   * On a dep_root mismatch (reorg, or initial sync delivering a fresher head) we refetch
   * just the affected epoch, mirroring `AttestationDutiesService.onNewHead`.
   */
  private onNewHead = async ({
    slot,
    previousDutyDependentRoot,
    currentDutyDependentRoot,
  }: HeadEventData): Promise<void> => {
    const currentEpoch = computeEpochAtSlot(slot);
    const isPostFulu = isForkPostFulu(this.config.getForkName(slot));

    if (isPostFulu) {
      await this.refetchIfDepRootChanged(currentEpoch, previousDutyDependentRoot);
      await this.refetchIfDepRootChanged(currentEpoch + 1, currentDutyDependentRoot);
    } else {
      await this.refetchIfDepRootChanged(currentEpoch, currentDutyDependentRoot);
    }
  };

  private async refetchIfDepRootChanged(epoch: Epoch, expectedDepRoot: RootHex): Promise<void> {
    const cached = this.proposers.get(epoch);
    if (!cached || cached.dependentRoot === expectedDepRoot) {
      return;
    }

    this.logger.debug("Proposer duties dep_root changed, refetching", {
      epoch,
      priorDependentRoot: cached.dependentRoot,
      newDependentRoot: expectedDepRoot,
    });
    await this.pollBeaconProposers(epoch);
  }

  /**
   * Pre-Fulu boundary fetch. Because pre-Fulu proposer shuffling has 0-epoch look-ahead, a
   * proposal for the first slot of the new epoch otherwise goes through the slow path every
   * time: the proposal can only happen *after* we download and process the new duties from
   * the BN. Polling ~1s before the boundary, while `PrepareNextSlotScheduler` is finishing
   * the upcoming-epoch transition, lets us land on a hot BN cache and avoid the miss.
   *
   * See https://github.com/ChainSafe/lodestar/issues/5792.
   */
  private async pollBeaconProposersBeforeBoundary(
    currentSlot: Slot,
    nextEpoch: Epoch,
    signal: AbortSignal
  ): Promise<void> {
    const nextSlot = currentSlot + 1;
    const lookAheadMs =
      this.config.SLOT_DURATION_MS - this.config.getSlotComponentDurationMs(BLOCK_DUTIES_LOOKAHEAD_BPS);
    await sleep(this.clock.msToSlot(nextSlot) - lookAheadMs, signal);
    this.logger.debug("Polling proposers for the next epoch", {nextEpoch, currentSlot});
    await this.pollBeaconProposers(nextEpoch);
  }

  /**
   * Notify block production for *newly discovered* proposers in this slot. Notifications are
   * deduplicated per-slot so that a late SSE refetch can extend the proposer set without
   * triggering a duplicate `createAndPublishBlock` for already-notified validators.
   *
   * ## Multi-notification safety
   *
   * Within a single slot the cache can be updated from several sources (cold-cache backfill at
   * startup, SSE-driven reorg refetch). Each update may fire this function again. The contract
   * we keep is: each pubkey is notified *at most once per slot*. The additional notifications
   * only carry proposers that were not part of an earlier notification.
   *
   * Is this safe? Firstly, the dedup above guarantees we never ask the same validator to
   * propose twice for the same slot. Secondly, slashing protection in `ValidatorStore` acts as
   * a second line of defense should the dedup ever fail. Together they provide an acceptable
   * level of safety for the "notify-from-cache, refine-after-refetch" pattern.
   */
  private notifyProposersForSlot(slot: Slot): void {
    if (slot !== this.notifiedSlot) {
      this.notifiedSlot = slot;
      this.notifiedSlotInitialPass = false;
      this.notifiedProposers.clear();
    }

    const isLateDetection = this.notifiedSlotInitialPass;
    this.notifiedSlotInitialPass = true;

    const newProposers: BLSPubkey[] = [];
    for (const pubkey of this.getblockProposersAtSlot(slot)) {
      const pubkeyHex = toPubkeyHex(pubkey);
      if (!this.notifiedProposers.has(pubkeyHex)) {
        this.notifiedProposers.add(pubkeyHex);
        newProposers.push(pubkey);
      }
    }

    if (newProposers.length === 0) {
      return;
    }

    if (isLateDetection) {
      this.metrics?.newProposalDutiesDetected.inc();
      this.logger.debug("Detected new block proposer", {slot});
    }
    this.notifyBlockProductionFn(slot, newProposers);
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
    // Concurrent polls for the same epoch (e.g. `onNewHead` and `runEveryEpochTask` racing)
    // both write here last-write-wins. The pre-refactor per-slot poll healed any stale write
    // on the next slot; in the event-driven model staleness can persist until the next
    // dep_root change. In practice the same BN serves both calls so they return identical
    // payloads — accept the rare race rather than serialising fetches.
    this.proposers.set(epoch, {dependentRoot, data: relevantDuties});

    if (prior && prior.dependentRoot !== dependentRoot) {
      this.metrics?.proposerDutiesReorg.inc();
      this.logger.warn("Proposer duties re-org. This may happen from time to time", {
        priorDependentRoot: prior.dependentRoot,
        dependentRoot,
      });
    }

    // If this fetch revealed proposer(s) for the active slot that the last `runEverySlotTask`
    // missed (cold cache at startup, or duties shifted by a reorg), notify now.
    if (this.notifiedSlot >= GENESIS_SLOT && computeEpochAtSlot(this.notifiedSlot) === epoch) {
      this.notifyProposersForSlot(this.notifiedSlot);
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
