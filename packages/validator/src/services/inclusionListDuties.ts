import {ApiClient, routes} from "@lodestar/api";
import {ChainForkConfig} from "@lodestar/config";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {computeEpochAtSlot, isStartSlotOfEpoch} from "@lodestar/state-transition";
import {Epoch, RootHex, Slot, ValidatorIndex} from "@lodestar/types";
import {sleep, toPubkeyHex} from "@lodestar/utils";
import {PubkeyHex} from "../types.js";
import {IClock, LoggerVc} from "../util/index.js";
import {ChainHeaderTracker, HeadEventData} from "./chainHeaderTracker.js";
import {SyncingStatusTracker} from "./syncingStatusTracker.js";
import {ValidatorStore} from "./validatorStore.js";

/** Only retain `HISTORICAL_DUTIES_EPOCHS` duties prior to the current epoch. */
// TODO HEZE: Do we need 2 epochs like attestations?
const HISTORICAL_DUTIES_EPOCHS = 2;

const HEZE_FORK_LOOKAHEAD_EPOCHS = 1;

type InclusionListDuty = routes.validator.InclusionListDuty;
// To assist with readability
type InclusionListDutiesAtEpoch = {dependentRoot: RootHex; dutiesByIndex: Map<ValidatorIndex, InclusionListDuty>};

/**
 * Similar to AttestationDutiesService but
 *   - No generating and caching selection proof
 *   - No handling and maintaining subnet subscription
 */
export class InclusionListDutiesService {
  /** Maps a validator public key to their duties for each epoch */
  private readonly dutiesByIndexByEpoch = new Map<Epoch, InclusionListDutiesAtEpoch>();
  /**
   * We may receive new dependentRoot of an epoch but it's not the last slot of epoch
   * so we have to wait for getting close to the next epoch to redownload new inclusionListDuties.
   */
  private readonly pendingDependentRootByEpoch = new Map<Epoch, RootHex>();

  constructor(
    private readonly config: ChainForkConfig,
    private readonly logger: LoggerVc,
    private readonly api: ApiClient,
    private clock: IClock,
    private readonly validatorStore: ValidatorStore,
    chainHeadTracker: ChainHeaderTracker,
    syncingStatusTracker: SyncingStatusTracker
  ) {
    // Running this task every epoch is safe since a re-org of two epochs is very unlikely
    // TODO: If the re-org event is reliable consider re-running then
    clock.runEveryEpoch(this.runDutiesTasks);
    clock.runEverySlot(this.prepareForNextEpoch);
    chainHeadTracker.runOnNewHead(this.onNewHead);
    syncingStatusTracker.runOnResynced(async (slot) => {
      // Skip on first slot of epoch since tasks are already scheduled
      if (!isStartSlotOfEpoch(slot)) {
        return this.runDutiesTasks(computeEpochAtSlot(slot));
      }
    });
  }

  removeDutiesForKey(pubkey: PubkeyHex): void {
    for (const [epoch, dutiesAtEpoch] of this.dutiesByIndexByEpoch) {
      for (const [vIndex, duty] of dutiesAtEpoch.dutiesByIndex) {
        if (toPubkeyHex(duty.pubkey) === pubkey) {
          dutiesAtEpoch.dutiesByIndex.delete(vIndex);
          if (dutiesAtEpoch.dutiesByIndex.size === 0) {
            this.dutiesByIndexByEpoch.delete(epoch);
          }
        }
      }
    }
  }

  /** Returns all `ValidatorDuty` for the given `slot` */
  getDutiesAtSlot(slot: Slot): InclusionListDuty[] {
    const epoch = computeEpochAtSlot(slot);
    const duties: InclusionListDuty[] = [];
    const epochDuties = this.dutiesByIndexByEpoch.get(epoch);
    if (epochDuties === undefined) {
      return duties;
    }

    for (const validatorDuty of epochDuties.dutiesByIndex.values()) {
      if (validatorDuty.slot === slot) {
        duties.push(validatorDuty);
      }
    }

    return duties;
  }

  /**
   * If a reorg dependent root comes at a slot other than last slot of epoch
   * just update this.pendingDependentRootByEpoch() and process here
   */
  private prepareForNextEpoch = async (slot: Slot, signal: AbortSignal): Promise<void> => {
    // only interested in last slot of epoch
    if ((slot + 1) % SLOTS_PER_EPOCH !== 0) {
      return;
    }

    // during the 1 / 3 of epoch, last block of epoch may come
    await sleep(this.clock.msToSlot(slot + 1 / 3), signal);

    const nextEpoch = computeEpochAtSlot(slot) + 1;
    const dependentRoot = this.dutiesByIndexByEpoch.get(nextEpoch)?.dependentRoot;
    const pendingDependentRoot = this.pendingDependentRootByEpoch.get(nextEpoch);
    if (dependentRoot && pendingDependentRoot && dependentRoot !== pendingDependentRoot) {
      // this happens when pendingDependentRoot is not the last block of an epoch
      this.logger.info("Redownload inclusion list duties when it's close to epoch boundary", {nextEpoch, slot});
      await this.handleInclusionListDutiesReorg(nextEpoch, slot, dependentRoot, pendingDependentRoot);
    }
  };

  private runDutiesTasks = async (epoch: Epoch): Promise<void> => {
    // Before HEZE fork (+ lookahead) no need to check duties
    if (epoch < this.config.HEZE_FORK_EPOCH - HEZE_FORK_LOOKAHEAD_EPOCHS) {
      return;
    }

    await Promise.all([
      // Run pollInclusionListCommittee immediately for all known local indices
      this.pollInclusionListCommittee(epoch, this.validatorStore.getAllLocalIndices()).catch((e: Error) => {
        this.logger.error("Error on poll inclusion list committee", {epoch}, e);
      }),

      // At the same time fetch any remaining unknown validator indices, then poll duties for those newIndices only
      this.validatorStore
        .pollValidatorIndices()
        .then((newIndices) => this.pollInclusionListCommittee(epoch, newIndices))
        .catch((e: Error) => {
          this.logger.error("Error on poll indices and inclusion list committee", {epoch}, e);
        }),
    ]);

    // After both, prune
    this.pruneOldDuties(epoch);
  };

  /**
   * Query the beacon node for inclusion list duties for any known validators.
   *
   * This function will perform (in the following order):
   *
   * 1. Poll for current-epoch duties and update the local duties map.
   * 2. As above, but for the next-epoch.
   * 3. Prune old entries from duties.
   */
  private async pollInclusionListCommittee(currentEpoch: Epoch, indexArr: ValidatorIndex[]): Promise<void> {
    const nextEpoch = currentEpoch + 1;

    // No need to bother the BN if we don't have any validators.
    if (indexArr.length === 0) {
      return;
    }

    for (const epoch of [currentEpoch, nextEpoch]) {
      // Download the duties and update the duties for the current and next epoch.
      await this.pollInclusionListCommitteeForEpoch(epoch, indexArr).catch((e: Error) => {
        this.logger.error("Failed to download inclusion list duties", {epoch}, e);
      });
    }
  }

  /**
   * For the given `indexArr`, download the duties for the given `epoch` and store them in duties.
   */
  private async pollInclusionListCommitteeForEpoch(epoch: Epoch, indexArr: ValidatorIndex[]): Promise<void> {
    // Don't fetch duties for epochs before genesis. However, should fetch epoch 0 duties at epoch -1
    if (epoch < 0) {
      return;
    }

    const res = await this.api.validator.getInclusionListCommitteeDuties({epoch, indices: indexArr});
    const inclusionListDuties = res.value();
    const {dependentRoot} = res.meta();
    const relevantDuties = inclusionListDuties.filter((duty) => {
      const pubkeyHex = toPubkeyHex(duty.pubkey);
      return this.validatorStore.hasVotingPubkey(pubkeyHex) && this.validatorStore.isDoppelgangerSafe(pubkeyHex);
    });

    this.logger.debug("Downloaded inclusion list duties", {epoch, dependentRoot, count: relevantDuties.length});

    const dutiesAtEpoch = this.dutiesByIndexByEpoch.get(epoch);
    const priorDependentRoot = dutiesAtEpoch?.dependentRoot;
    const dependentRootChanged = priorDependentRoot !== undefined && priorDependentRoot !== dependentRoot;

    if (!priorDependentRoot || dependentRootChanged) {
      const dutiesByIndex = new Map<ValidatorIndex, InclusionListDuty>();
      for (const duty of relevantDuties) {
        dutiesByIndex.set(duty.validatorIndex, duty);
      }
      this.dutiesByIndexByEpoch.set(epoch, {dependentRoot, dutiesByIndex});

      if (priorDependentRoot && dependentRootChanged) {
        this.logger.warn("Inclusion list duties re-org. This may happen from time to time", {
          priorDependentRoot: priorDependentRoot,
          dependentRoot: dependentRoot,
          epoch,
        });
      }
    } else {
      const existingDuties = dutiesAtEpoch.dutiesByIndex;
      const existingDutiesCount = existingDuties.size;
      const discoveredNewDuties = relevantDuties.length > existingDutiesCount;

      if (discoveredNewDuties) {
        for (const duty of relevantDuties) {
          if (!existingDuties.has(duty.validatorIndex)) {
            existingDuties.set(duty.validatorIndex, duty);
          }
        }

        this.logger.debug("Discovered new inclusion list duties", {
          epoch,
          dependentRoot,
          count: relevantDuties.length - existingDutiesCount,
        });
      }
    }
  }

  private async handleInclusionListDutiesReorg(
    dutyEpoch: Epoch,
    slot: Slot,
    oldDependentRoot: RootHex,
    newDependentRoot: RootHex
  ): Promise<void> {
    const logContext = {dutyEpoch, slot, oldDependentRoot, newDependentRoot};
    this.logger.debug("Redownload inclusion list duties", logContext);

    await this.pollInclusionListCommitteeForEpoch(dutyEpoch, this.validatorStore.getAllLocalIndices())
      .then(() => {
        this.pendingDependentRootByEpoch.delete(dutyEpoch);
      })
      .catch((e: Error) => {
        this.logger.error("Failed to redownload inclusion list duties when reorg happens", logContext, e);
      });
  }

  /**
   * inclusion list duties may be reorged due to 2 scenarios:
   *   1. node is syncing (for nextEpoch duties)
   *   2. node is reorged
   * previousDutyDependentRoot = get_block_root_at_slot(state, compute_start_slot_at_epoch(epoch - 1) - 1)
   *   => dependent root of current epoch
   * currentDutyDependentRoot = get_block_root_at_slot(state, compute_start_slot_at_epoch(epoch) - 1)
   *   => dependent root of next epoch
   */
  private onNewHead = async ({
    slot,
    head,
    previousDutyDependentRoot,
    currentDutyDependentRoot,
  }: HeadEventData): Promise<void> => {
    const currentEpoch = computeEpochAtSlot(slot);
    const nextEpoch = currentEpoch + 1;
    const nextTwoEpoch = currentEpoch + 2;
    const nextTwoEpochDependentRoot = this.dutiesByIndexByEpoch.get(currentEpoch + 2)?.dependentRoot;

    // this may happen ONLY when node is syncing
    // it's safe to get inclusion list duties at epoch n + 1 thanks to nextEpochShuffling cache
    // but it's an issue to request inclusion list duties for epoch n + 2 as dependent root keeps changing while node is syncing
    // see https://github.com/ChainSafe/lodestar/issues/3211
    if (nextTwoEpochDependentRoot && head !== nextTwoEpochDependentRoot) {
      // last slot of epoch, we're sure it's the correct dependent root
      if ((slot + 1) % SLOTS_PER_EPOCH === 0) {
        this.logger.info("Next 2 epoch inclusion list duties reorg", {slot, dutyEpoch: nextTwoEpoch, head});
        await this.handleInclusionListDutiesReorg(nextTwoEpoch, slot, nextTwoEpochDependentRoot, head);
      } else {
        this.logger.debug("Potential next 2 epoch inclusion list duties reorg", {slot, dutyEpoch: nextTwoEpoch, head});
        // node may send adjacent onHead events while it's syncing
        // wait for getting close to next epoch to make sure the dependRoot
        this.pendingDependentRootByEpoch.set(nextTwoEpoch, head);
      }
    }

    // dependent root for next epoch changed
    const nextEpochDependentRoot = this.dutiesByIndexByEpoch.get(nextEpoch)?.dependentRoot;
    if (nextEpochDependentRoot && currentDutyDependentRoot !== nextEpochDependentRoot) {
      this.logger.warn("Potential next epoch inclusion list duties reorg", {
        slot,
        dutyEpoch: nextEpoch,
        priorDependentRoot: nextEpochDependentRoot,
        newDependentRoot: currentDutyDependentRoot,
      });
      await this.handleInclusionListDutiesReorg(nextEpoch, slot, nextEpochDependentRoot, currentDutyDependentRoot);
    }

    // dependent root for current epoch changed
    const currentEpochDependentRoot = this.dutiesByIndexByEpoch.get(currentEpoch)?.dependentRoot;
    if (currentEpochDependentRoot && currentEpochDependentRoot !== previousDutyDependentRoot) {
      this.logger.warn("Potential current epoch inclusion list duties reorg", {
        slot,
        dutyEpoch: currentEpoch,
        priorDependentRoot: currentEpochDependentRoot,
        newDependentRoot: previousDutyDependentRoot,
      });
      await this.handleInclusionListDutiesReorg(
        currentEpoch,
        slot,
        currentEpochDependentRoot,
        previousDutyDependentRoot
      );
    }
  };

  /** Run once per epoch to prune duties map */
  private pruneOldDuties(currentEpoch: Epoch): void {
    for (const byEpochMap of [this.dutiesByIndexByEpoch, this.pendingDependentRootByEpoch]) {
      for (const epoch of byEpochMap.keys()) {
        if (epoch + HISTORICAL_DUTIES_EPOCHS < currentEpoch) {
          byEpochMap.delete(epoch);
        }
      }
    }
  }
}
