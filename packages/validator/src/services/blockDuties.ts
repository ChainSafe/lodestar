import {computeEpochAtSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {BLSPubkey, Epoch, phase0, Root, Slot} from "@chainsafe/lodestar-types";
import {ILogger} from "@chainsafe/lodestar-utils";
import {toHexString} from "@chainsafe/ssz";
import {IApiClient} from "../api";
import {extendError, notAborted} from "../util";
import {IClock} from "../util/clock";
import {differenceHex} from "../util/difference";
import {ValidatorStore} from "./validatorStore";

/** Only retain `HISTORICAL_DUTIES_EPOCHS` duties prior to the current epoch */
const HISTORICAL_DUTIES_EPOCHS = 2;

type BlockDutyAtEpoch = {dependentRoot: Root; data: phase0.ProposerDuty[]};
type NotifyBlockProductionFn = (slot: Slot, proposers: BLSPubkey[]) => void;

export class BlockDutiesService {
  private readonly config: IBeaconConfig;
  private readonly logger: ILogger;
  private readonly apiClient: IApiClient;
  private readonly validatorStore: ValidatorStore;
  /** Notify the block service if it should produce a block. */
  private readonly notifyBlockProductionFn: NotifyBlockProductionFn;
  /** Maps an epoch to all *local* proposers in this epoch. Notably, this does not contain
      proposals for any validators which are not registered locally. */
  private readonly proposers = new Map<Epoch, BlockDutyAtEpoch>();

  constructor(
    config: IBeaconConfig,
    logger: ILogger,
    apiClient: IApiClient,
    clock: IClock,
    validatorStore: ValidatorStore,
    notifyBlockProductionFn: NotifyBlockProductionFn
  ) {
    this.config = config;
    this.logger = logger;
    this.apiClient = apiClient;
    this.validatorStore = validatorStore;
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
    const epoch = computeEpochAtSlot(this.config, slot);
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

  private runBlockDutiesTask = async (slot: Slot): Promise<void> => {
    await this.pollBeaconProposers(slot).catch((e) => {
      if (notAborted(e)) this.logger.error("Error on pollBeaconProposers", {}, e);
    });

    this.pruneOldDuties(computeEpochAtSlot(this.config, slot));
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
  private async pollBeaconProposers(currentSlot: Slot): Promise<void> {
    const currentEpoch = computeEpochAtSlot(this.config, currentSlot);

    // Notify the block proposal service for any proposals that we have in our cache.
    const initialBlockProposers = this.getblockProposersAtSlot(currentSlot);
    if (initialBlockProposers.length > 0) {
      this.notifyBlockProductionFn(currentSlot, initialBlockProposers);
    }

    const localPubkeys = this.validatorStore.votingPubkeys();

    // Only download duties and push out additional block production events if we have some
    // validators.
    if (localPubkeys.length > 0) {
      const proposerDuties = await this.apiClient.validator.getProposerDuties(currentEpoch).catch((e) => {
        throw extendError(e, "Error on getProposerDuties");
      });
      const dependentRoot = proposerDuties.dependentRoot;
      const pubkeysSet = new Set(localPubkeys.map((pk) => toHexString(pk)));
      const relevantDuties = proposerDuties.data.filter((duty) => pubkeysSet.has(toHexString(duty.pubkey)));

      this.logger.debug("Downloaded proposer duties", {
        epoch: currentEpoch,
        dependentRoot: toHexString(dependentRoot),
        count: relevantDuties.length,
      });

      const prior = this.proposers.get(currentEpoch);
      this.proposers.set(currentEpoch, {dependentRoot, data: relevantDuties});

      if (prior && !this.config.types.Root.equals(prior.dependentRoot, dependentRoot)) {
        this.logger.warn("Proposer duties re-org. This may happen from time to time", {
          priorDependentRoot: toHexString(prior.dependentRoot),
          dependentRoot: toHexString(dependentRoot),
        });
      }
    }

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

  /** Run once per epoch to prune `this.proposers` map */
  private pruneOldDuties(currentEpoch: Epoch): void {
    for (const epoch of this.proposers.keys()) {
      if (epoch + HISTORICAL_DUTIES_EPOCHS < currentEpoch) {
        this.proposers.delete(epoch);
      }
    }
  }
}
