import {computeEpochAtSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {BLSPubkey, Epoch, Root, Slot, ssz} from "@chainsafe/lodestar-types";
import {toHexString} from "@chainsafe/ssz";
import {Api, routes} from "@chainsafe/lodestar-api";
import {IClock, extendError, differenceHex, ILoggerVc} from "../util/index.js";
import {ValidatorStore} from "./validatorStore.js";
import {PubkeyHex} from "../types.js";

/** Only retain `HISTORICAL_DUTIES_EPOCHS` duties prior to the current epoch */
const HISTORICAL_DUTIES_EPOCHS = 2;
// Re-declaring to not have to depend on `lodestar-params` just for this 0
const GENESIS_EPOCH = 0;
export const GENESIS_SLOT = 0;

type BlockDutyAtEpoch = {dependentRoot: Root; data: routes.validator.ProposerDuty[]};
type NotifyBlockProductionFn = (slot: Slot, proposers: BLSPubkey[]) => void;

export class BlockDutiesService {
  /** Notify the block service if it should produce a block. */
  private readonly notifyBlockProductionFn: NotifyBlockProductionFn;
  /** Maps an epoch to all *local* proposers in this epoch. Notably, this does not contain
      proposals for any validators which are not registered locally. */
  private readonly proposers = new Map<Epoch, BlockDutyAtEpoch>();

  constructor(
    private readonly logger: ILoggerVc,
    private readonly api: Api,
    clock: IClock,
    private readonly validatorStore: ValidatorStore,
    notifyBlockProductionFn: NotifyBlockProductionFn
  ) {
    this.notifyBlockProductionFn = notifyBlockProductionFn;

    // TODO: Instead of polling every CLOCK_SLOT, poll every CLOCK_EPOCH and track re-org events
    //       only then re-fetch the block duties. Make sure most clients (including Lodestar)
    //       properly emit the re-org event
    clock.runEverySlot(this.runBlockDutiesTask);
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
          publicKeys.set(toHexString(proposer.pubkey), proposer.pubkey);
        }
      }
    }

    return Array.from(publicKeys.values());
  }

  removeDutiesForKey(pubkey: PubkeyHex): void {
    for (const blockDutyAtEpoch of this.proposers.values()) {
      blockDutyAtEpoch.data = blockDutyAtEpoch.data.filter((proposer) => {
        return toHexString(proposer.pubkey) !== pubkey;
      });
    }
  }

  private runBlockDutiesTask = async (slot: Slot): Promise<void> => {
    try {
      if (slot < 0) {
        // Before genesis, fetch the genesis duties but don't notify block production
        // Only fetch duties once since there is not possible to re-org. TODO: Review
        if (!this.proposers.has(GENESIS_EPOCH)) {
          await this.pollBeaconProposers(GENESIS_EPOCH);
        }
      } else {
        await this.pollBeaconProposersAndNotify(slot);
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
   * However, we also have the slashing protection as a second line of defence. These two factors
   * provide an acceptable level of safety.
   *
   * It's important to note that since there is a 0-epoch look-ahead (i.e., no look-ahead) for block
   * proposers then it's very likely that a proposal for the first slot of the epoch will need go
   * through the slow path every time. I.e., the proposal will only happen after we've been able to
   * download and process the duties from the BN. This means it is very important to ensure this
   * function is as fast as possible.
   */
  private async pollBeaconProposersAndNotify(currentSlot: Slot): Promise<void> {
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
      // TODO: Add Metrics
      // this.metrics.proposalChanged.inc();
    }
  }

  private async pollBeaconProposers(epoch: Epoch): Promise<void> {
    // Only download duties and push out additional block production events if we have some validators.
    if (!this.validatorStore.hasSomeValidators()) {
      return;
    }

    const proposerDuties = await this.api.validator.getProposerDuties(epoch).catch((e: Error) => {
      throw extendError(e, "Error on getProposerDuties");
    });
    const dependentRoot = proposerDuties.dependentRoot;
    const relevantDuties = proposerDuties.data.filter((duty) =>
      this.validatorStore.hasVotingPubkey(toHexString(duty.pubkey))
    );

    this.logger.debug("Downloaded proposer duties", {
      epoch,
      dependentRoot: toHexString(dependentRoot),
      count: relevantDuties.length,
    });

    const prior = this.proposers.get(epoch);
    this.proposers.set(epoch, {dependentRoot, data: relevantDuties});

    if (prior && !ssz.Root.equals(prior.dependentRoot, dependentRoot)) {
      this.logger.warn("Proposer duties re-org. This may happen from time to time", {
        priorDependentRoot: toHexString(prior.dependentRoot),
        dependentRoot: toHexString(dependentRoot),
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
