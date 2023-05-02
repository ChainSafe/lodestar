import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {ChainForkConfig} from "@lodestar/config";
import {
  ATTESTATION_SUBNET_COUNT,
  EPOCHS_PER_RANDOM_SUBNET_SUBSCRIPTION,
  ForkName,
  RANDOM_SUBNETS_PER_VALIDATOR,
  SLOTS_PER_EPOCH,
} from "@lodestar/params";
import {Epoch, Slot, ssz} from "@lodestar/types";
import {Logger, MapDef, randBetween} from "@lodestar/utils";
import {shuffle} from "../../util/shuffle.js";
import {ClockEvent, IClock} from "../../util/clock.js";
import {GossipTopic, GossipType} from "../gossip/index.js";
import {MetadataController} from "../metadata.js";
import {SubnetMap, RequestedSubnet} from "../peers/utils/index.js";
import {getActiveForks} from "../forks.js";
import {NetworkCoreMetrics} from "../core/metrics.js";
import {IAttnetsService, CommitteeSubscription, SubnetsServiceOpts, RandBetweenFn, ShuffleFn} from "./interface.js";

/**
 * The time (in slots) before a last seen validator is considered absent and we unsubscribe from the random
 * gossip topics that we subscribed to due to the validator connection.
 */
const LAST_SEEN_VALIDATOR_TIMEOUT = 150;

const gossipType = GossipType.beacon_attestation;

enum SubnetSource {
  committee = "committee",
  random = "random",
}

/**
 * Manage random (long lived) subnets and committee (short lived) subnets.
 */
export class AttnetsService implements IAttnetsService {
  /** Committee subnets - PeerManager must find peers for those */
  private committeeSubnets = new SubnetMap();
  /**
   * All currently subscribed short-lived subnets, for attestation aggregation
   * This class will tell gossip to subscribe and un-subscribe
   * If a value exists for `SubscriptionId` it means that gossip subscription is active in network.gossip
   */
  private subscriptionsCommittee = new SubnetMap();
  /** Same as `subscriptionsCommittee` but for long-lived subnets. May overlap with `subscriptionsCommittee` */
  private subscriptionsRandom = new SubnetMap();
  /**
   * Map of an aggregator at a slot and subnet
   * Used to determine if we should process an attestation.
   */
  private aggregatorSlotSubnet = new MapDef<Slot, Set<number>>(() => new Set());

  /**
   * A collection of seen validators. These dictate how many random subnets we should be
   * subscribed to. As these time out, we unsubscribe from the required random subnets and update our ENR.
   * This is a map of validator index and its last active slot.
   */
  private knownValidators = new Map<number, Slot>();

  private randBetweenFn: RandBetweenFn;
  private shuffleFn: ShuffleFn;

  constructor(
    private readonly config: ChainForkConfig,
    private readonly clock: IClock,
    private readonly gossip: {
      subscribeTopic: (topic: GossipTopic) => void;
      unsubscribeTopic: (topic: GossipTopic) => void;
    },
    private readonly metadata: MetadataController,
    private readonly logger: Logger,
    private readonly metrics: NetworkCoreMetrics | null,
    private readonly opts?: SubnetsServiceOpts
  ) {
    // if subscribeAllSubnets, we act like we have >= ATTESTATION_SUBNET_COUNT validators connecting to this node
    // so that we have enough subnet topic peers, see https://github.com/ChainSafe/lodestar/issues/4921
    if (this.opts?.subscribeAllSubnets) {
      for (let subnet = 0; subnet < ATTESTATION_SUBNET_COUNT; subnet++) {
        this.committeeSubnets.request({subnet, toSlot: Infinity});
      }
    }

    this.randBetweenFn = this.opts?.randBetweenFn ?? randBetween;
    this.shuffleFn = this.opts?.shuffleFn ?? shuffle;
    if (metrics) {
      metrics.attnetsService.subscriptionsRandom.addCollect(() => this.onScrapeLodestarMetrics(metrics));
    }
  }

  start(): void {
    this.clock.on(ClockEvent.slot, this.onSlot);
    this.clock.on(ClockEvent.epoch, this.onEpoch);
  }

  stop(): void {
    this.clock.off(ClockEvent.slot, this.onSlot);
    this.clock.off(ClockEvent.epoch, this.onEpoch);
  }

  /**
   * Get all active subnets for the hearbeat.
   */
  getActiveSubnets(): RequestedSubnet[] {
    // Omit subscriptionsRandom, not necessary to force the network component to keep peers on that subnets
    return this.committeeSubnets.getActiveTtl(this.clock.currentSlot);
  }

  /**
   * Called from the API when validator is a part of a committee.
   */
  addCommitteeSubscriptions(subscriptions: CommitteeSubscription[]): void {
    const currentSlot = this.clock.currentSlot;
    let addedknownValidators = false;
    const subnetsToSubscribe: RequestedSubnet[] = [];

    for (const {validatorIndex, subnet, slot, isAggregator} of subscriptions) {
      // Add known validator
      if (!this.knownValidators.has(validatorIndex)) addedknownValidators = true;
      this.knownValidators.set(validatorIndex, currentSlot);

      // the peer-manager heartbeat will help find the subnet
      this.committeeSubnets.request({subnet, toSlot: slot + 1});
      if (isAggregator) {
        // need exact slot here
        subnetsToSubscribe.push({subnet, toSlot: slot});
        this.aggregatorSlotSubnet.getOrDefault(slot).add(subnet);
      }
    }

    // Trigger gossip subscription first, in batch
    if (subnetsToSubscribe.length > 0) {
      this.subscribeToSubnets(
        subnetsToSubscribe.map((sub) => sub.subnet),
        SubnetSource.committee
      );
    }
    // Then, register the subscriptions
    for (const subscription of subnetsToSubscribe) {
      this.subscriptionsCommittee.request(subscription);
    }

    if (addedknownValidators) this.rebalanceRandomSubnets();
  }

  /**
   * Check if a subscription is still active before handling a gossip object
   */
  shouldProcess(subnet: number, slot: Slot): boolean {
    if (!this.aggregatorSlotSubnet.has(slot)) {
      return false;
    }
    return this.aggregatorSlotSubnet.getOrDefault(slot).has(subnet);
  }

  /** Call ONLY ONCE: Two epoch before the fork, re-subscribe all existing random subscriptions to the new fork  */
  subscribeSubnetsToNextFork(nextFork: ForkName): void {
    this.logger.info("Suscribing to random attnets to next fork", {nextFork});
    for (const subnet of this.subscriptionsRandom.getAll()) {
      this.gossip.subscribeTopic({type: gossipType, fork: nextFork, subnet});
    }
  }

  /** Call  ONLY ONCE: Two epochs after the fork, un-subscribe all subnets from the old fork */
  unsubscribeSubnetsFromPrevFork(prevFork: ForkName): void {
    this.logger.info("Unsuscribing to random attnets from prev fork", {prevFork});
    for (let subnet = 0; subnet < ATTESTATION_SUBNET_COUNT; subnet++) {
      if (!this.opts?.subscribeAllSubnets) {
        this.gossip.unsubscribeTopic({type: gossipType, fork: prevFork, subnet});
      }
    }
  }

  /**
   * Run per slot.
   */
  private onSlot = (slot: Slot): void => {
    try {
      // For node >= 64 validators, we should consistently subscribe to all subnets
      // it's important to check random subnets first
      // See https://github.com/ChainSafe/lodestar/issues/4929
      this.unsubscribeExpiredRandomSubnets(slot);
      this.unsubscribeExpiredCommitteeSubnets(slot);
    } catch (e) {
      this.logger.error("Error on AttnetsService.onSlot", {slot}, e as Error);
    }
  };

  /**
   * Run per epoch, clean-up operations that are not urgent
   */
  private onEpoch = (epoch: Epoch): void => {
    try {
      const slot = computeStartSlotAtEpoch(epoch);
      this.pruneExpiredKnownValidators(slot);
      this.pruneExpiredAggregator(slot);
    } catch (e) {
      this.logger.error("Error on AttnetsService.onEpoch", {epoch}, e as Error);
    }
  };

  /**
   * Unsubscribe to a committee subnet from subscribedCommitteeSubnets.
   * If a random subnet is present, we do not unsubscribe from it.
   */
  private unsubscribeExpiredCommitteeSubnets(slot: Slot): void {
    const expired = this.subscriptionsCommittee.getExpired(slot);
    if (expired.length > 0) {
      this.unsubscribeSubnets(expired, slot, SubnetSource.committee);
    }
  }

  /**
   * A random subnet has expired.
   * This function selects a new subnet to join, or extends the expiry if there are no more
   * available subnets to choose from.
   */
  private unsubscribeExpiredRandomSubnets(slot: Slot): void {
    const expired = this.subscriptionsRandom.getExpired(slot);
    const currentSlot = this.clock.currentSlot;

    if (expired.length === 0) {
      return;
    }

    if (this.knownValidators.size * RANDOM_SUBNETS_PER_VALIDATOR >= ATTESTATION_SUBNET_COUNT) {
      // Optimization: If we have to be subcribed to all subnets, no need to unsubscribe. Just extend the timeout
      for (const subnet of expired) {
        this.subscriptionsRandom.request({subnet, toSlot: this.randomSubscriptionSlotLen() + currentSlot});
      }
      return;
    }

    // Prune subnets and re-subcribe to new ones
    this.unsubscribeSubnets(expired, slot, SubnetSource.random);
    this.rebalanceRandomSubnets();
  }

  /**
   * A known validator has not sent a subscription in a while. They are considered offline and the
   * beacon node no longer needs to be subscribed to the allocated random subnets.
   *
   * We don't keep track of a specific validator to random subnet, rather the ratio of active
   * validators to random subnets. So when a validator goes offline, we can simply remove the
   * allocated amount of random subnets.
   */
  private pruneExpiredKnownValidators(currentSlot: Slot): void {
    let deletedKnownValidators = false;
    for (const [index, slot] of this.knownValidators.entries()) {
      if (currentSlot > slot + LAST_SEEN_VALIDATOR_TIMEOUT) {
        const deleted = this.knownValidators.delete(index);
        if (deleted) deletedKnownValidators = true;
      }
    }

    if (deletedKnownValidators) this.rebalanceRandomSubnets();
  }

  /**
   * No need to track aggregator for past slots.
   * @param currentSlot
   */
  private pruneExpiredAggregator(currentSlot: Slot): void {
    for (const slot of this.aggregatorSlotSubnet.keys()) {
      if (currentSlot > slot) {
        this.aggregatorSlotSubnet.delete(slot);
      }
    }
  }

  /**
   * Called when we have new validators or expired validators.
   * knownValidators should be updated before this function.
   */
  private rebalanceRandomSubnets(): void {
    const slot = this.clock.currentSlot;
    // By limiting to ATTESTATION_SUBNET_COUNT, if target is still over subnetDiff equals 0
    const targetRandomSubnetCount = Math.min(
      this.knownValidators.size * RANDOM_SUBNETS_PER_VALIDATOR,
      ATTESTATION_SUBNET_COUNT
    );
    const subnetDiff = targetRandomSubnetCount - this.subscriptionsRandom.size;

    // subscribe to more random subnets
    if (subnetDiff > 0) {
      const activeSubnets = new Set(this.subscriptionsRandom.getActive(slot));
      const allSubnets = Array.from({length: ATTESTATION_SUBNET_COUNT}, (_, i) => i);
      const availableSubnets = allSubnets.filter((subnet) => !activeSubnets.has(subnet));
      const subnetsToConnect = this.shuffleFn(availableSubnets).slice(0, subnetDiff);

      // Tell gossip to connect to the subnets if not connected already
      this.subscribeToSubnets(subnetsToConnect, SubnetSource.random);

      // Register these new subnets until some future slot
      for (const subnet of subnetsToConnect) {
        // the heartbeat will help connect to respective peers
        this.subscriptionsRandom.request({subnet, toSlot: this.randomSubscriptionSlotLen() + slot});
      }
    }

    // unsubscribe some random subnets
    if (subnetDiff < 0) {
      const activeRandomSubnets = this.subscriptionsRandom.getActive(slot);
      // TODO: Do we want to remove the oldest subnets or the newest subnets?
      // .slice(-2) will extract the last two items of the array
      const toRemoveSubnets = activeRandomSubnets.slice(subnetDiff);
      for (const subnet of toRemoveSubnets) {
        this.subscriptionsRandom.delete(subnet);
      }
      this.unsubscribeSubnets(toRemoveSubnets, slot, SubnetSource.random);
    }

    // If there has been a change update the local ENR bitfield
    if (subnetDiff !== 0) {
      this.updateMetadata();
    }
  }

  /** Update ENR */
  private updateMetadata(): void {
    const subnets = ssz.phase0.AttestationSubnets.defaultValue();
    for (const subnet of this.subscriptionsRandom.getAll()) {
      subnets.set(subnet, true);
    }

    // Only update metadata if necessary, setting `metadata.[key]` triggers a write to disk
    if (!ssz.phase0.AttestationSubnets.equals(subnets, this.metadata.attnets)) {
      this.metadata.attnets = subnets;
    }
  }

  /** Tigger a gossip subcription only if not already subscribed */
  private subscribeToSubnets(subnets: number[], src: SubnetSource): void {
    const forks = getActiveForks(this.config, this.clock.currentEpoch);
    for (const subnet of subnets) {
      if (!this.subscriptionsCommittee.has(subnet) && !this.subscriptionsRandom.has(subnet)) {
        for (const fork of forks) {
          this.gossip.subscribeTopic({type: gossipType, fork, subnet});
        }
        this.metrics?.attnetsService.subscribeSubnets.inc({subnet, src});
      }
    }
  }

  /** Trigger a gossip un-subscrition only if no-one is still subscribed */
  private unsubscribeSubnets(subnets: number[], slot: Slot, src: SubnetSource): void {
    // No need to unsubscribeTopic(). Return early to prevent repetitive extra work
    if (this.opts?.subscribeAllSubnets) return;

    const forks = getActiveForks(this.config, this.clock.currentEpoch);
    for (const subnet of subnets) {
      if (
        !this.subscriptionsCommittee.isActiveAtSlot(subnet, slot) &&
        !this.subscriptionsRandom.isActiveAtSlot(subnet, slot)
      ) {
        for (const fork of forks) {
          this.gossip.unsubscribeTopic({type: gossipType, fork, subnet});
        }
        this.metrics?.attnetsService.unsubscribeSubnets.inc({subnet, src});
      }
    }
  }

  private randomSubscriptionSlotLen(): Slot {
    return (
      this.randBetweenFn(EPOCHS_PER_RANDOM_SUBNET_SUBSCRIPTION, 2 * EPOCHS_PER_RANDOM_SUBNET_SUBSCRIPTION) *
      SLOTS_PER_EPOCH
    );
  }

  private onScrapeLodestarMetrics(metrics: NetworkCoreMetrics): void {
    metrics.attnetsService.committeeSubnets.set(this.committeeSubnets.size);
    metrics.attnetsService.subscriptionsCommittee.set(this.subscriptionsCommittee.size);
    metrics.attnetsService.subscriptionsRandom.set(this.subscriptionsRandom.size);
    let aggregatorCount = 0;
    for (const subnets of this.aggregatorSlotSubnet.values()) {
      aggregatorCount += subnets.size;
    }
    metrics.attnetsService.aggregatorSlotSubnetCount.set(aggregatorCount);
  }
}
