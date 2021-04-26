import {computeSubnetForCommitteesAtSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig, IForkName} from "@chainsafe/lodestar-config";
import {ATTESTATION_SUBNET_COUNT, phase0} from "@chainsafe/lodestar-types";
import {assert, ILogger, randBetween} from "@chainsafe/lodestar-utils";
import {ChainEvent, IBeaconChain} from "../../chain";
import {Eth2Gossipsub, GossipType} from "../gossip";
import {MetadataController} from "../metadata";
import {SubnetMap} from "../peers/utils";
import {IAttestationService, IAttestationServiceModules} from "./interface";

/// The time (in slots) before a last seen validator is considered absent and we unsubscribe from the random
/// gossip topics that we subscribed to due to the validator connection.
const LAST_SEEN_VALIDATOR_TIMEOUT = 150;

/**
 * Manage random (long lived) subnets and committee (short lived) subnets.
 */
export class AttestationService implements IAttestationService {
  private readonly config: IBeaconConfig;
  private readonly chain: IBeaconChain;
  private readonly gossip: Eth2Gossipsub;
  private readonly metadata: MetadataController;
  private readonly logger: ILogger;

  // Map of random subnets and the slot until they are needed of current fork
  private randomSubnets: SubnetMap;
  // Map of random subnets and the slot until they are needed of next fork
  // TODO: handle multiple hard forks?
  private nextForkRandomSubnets: SubnetMap | undefined;
  // Map of committee subnets and the slot until they are needed
  private committeeSubnets: SubnetMap;
  // subset of committeeSubnets with exact slot for aggregator
  private subscribedCommitteeSubnets: SubnetMap;

  private nextForkSubscriptionTimer: NodeJS.Timeout | undefined;

  /**
   * A collection of seen validators. These dictate how many random subnets we should be
   * subscribed to. As these time out, we unsubscribe for the required random subnets and update our ENR
   * This is a map of validator index and its last active slot.
   */
  private knownValidators = new Map<number, phase0.Slot>();

  constructor(modules: IAttestationServiceModules) {
    this.config = modules.config;
    this.chain = modules.chain;
    this.gossip = modules.gossip;
    this.metadata = modules.metadata;
    this.logger = modules.logger;
    const currentFork = this.chain.getForkName();
    this.randomSubnets = new SubnetMap(currentFork);
    this.committeeSubnets = new SubnetMap(currentFork);
    this.subscribedCommitteeSubnets = new SubnetMap(currentFork);
    const nextFork = this.getNextFork();
    if (nextFork) {
      this.nextForkRandomSubnets = new SubnetMap(nextFork.name);
    }
  }

  start(): void {
    this.chain.emitter.on(ChainEvent.clockSlot, this.onSlot);
    this.scheduleNextForkSubscription();
  }

  stop(): void {
    this.chain.emitter.off(ChainEvent.clockSlot, this.onSlot);
    if (this.nextForkSubscriptionTimer) {
      clearTimeout(this.nextForkSubscriptionTimer);
    }
  }

  /**
   * Get all active subnets for the hearbeat.
   */
  getActiveSubnets(): number[] {
    const currentSlot = this.chain.clock.currentSlot;
    const allSubnets = new Set([
      ...this.randomSubnets.getActive(currentSlot),
      ...this.committeeSubnets.getActive(currentSlot),
    ]);
    return Array.from(allSubnets);
  }

  getNextForkRandomSubnets(): number[] {
    if (this.nextForkRandomSubnets) {
      return this.nextForkRandomSubnets.getActive(this.chain.clock.currentSlot);
    }
    return [];
  }

  /**
   * Called from /eth/v1/validator/beacon_committee_subscriptions api when validator is an attester.
   */
  validatorSubscriptions(subscriptions: phase0.BeaconCommitteeSubscription[] = []): void {
    for (const {slot, committeesAtSlot, committeeIndex, validatorIndex, isAggregator} of subscriptions) {
      this.addKnownValidator(validatorIndex);
      const subnetId = computeSubnetForCommitteesAtSlot(this.config, slot, committeesAtSlot, committeeIndex);
      // the peer-manager heartbeat will help find the subnet
      this.committeeSubnets.request({subnetId, toSlot: slot + 1});
      if (isAggregator) {
        // need exact slot here
        this.handleSubscription(subnetId, slot);
      }
    }
  }

  /**
   * Consumed by attestation collector.
   */
  shouldProcessAttestation(subnet: number, slot: phase0.Slot): boolean {
    return this.subscribedCommitteeSubnets.getToSlot(subnet) === slot;
  }

  /**
   * When preparing for a hard fork, a validator must select and subscribe to random subnets of the future
   * fork versioning at least EPOCHS_PER_RANDOM_SUBNET_SUBSCRIPTION epochs in advance of the fork
   */
  private scheduleNextForkSubscription(): void {
    const {EPOCHS_PER_RANDOM_SUBNET_SUBSCRIPTION, SLOTS_PER_EPOCH, SECONDS_PER_SLOT} = this.config.params;

    const nextFork = this.getNextFork();
    // there is a planned hard fork
    if (nextFork && nextFork.slot !== Infinity) {
      let waitingSlots =
        nextFork.slot - EPOCHS_PER_RANDOM_SUBNET_SUBSCRIPTION * SLOTS_PER_EPOCH - this.chain.clock.currentSlot;
      if (waitingSlots < 0) {
        // we are probably less than EPOCHS_PER_RANDOM_SUBNET_SUBSCRIPTION to the next hardfork
        waitingSlots = 0;
      }
      this.logger.info("Preparing for the next fork random subnet subscriptions", {waitingSlots, nextFork});
      const timeToPreparedEpoch = waitingSlots * SECONDS_PER_SLOT * 1000;
      if (timeToPreparedEpoch > 0) {
        this.nextForkSubscriptionTimer = setTimeout(() => {
          this.subscribeToNextForkRandomSubnets(nextFork.name);
        }, timeToPreparedEpoch);
      }
    }
  }

  private getNextFork(): {name: IForkName; slot: phase0.Slot} | null {
    const currentFork = this.chain.getForkName();
    const forkInfoRecord = this.config.getForkInfoRecord();
    const allForks = Object.keys(forkInfoRecord) as IForkName[];
    const forkIndex = allForks.indexOf(currentFork);
    // there is a planned hard fork
    if (forkIndex !== allForks.length - 1) {
      const nextFork = allForks[forkIndex + 1];
      return forkInfoRecord[nextFork];
    }
    return null;
  }

  /**
   * Add validator to knownValidators list.
   */
  private addKnownValidator(validatorIndex: phase0.ValidatorIndex): void {
    const currentSlot = this.chain.clock.currentSlot;
    const currentFork = this.chain.getForkName();
    if (!this.knownValidators.get(validatorIndex)) {
      if (this.randomSubnets.getActive(currentSlot).length < ATTESTATION_SUBNET_COUNT) {
        for (let i = 0; i < this.config.params.RANDOM_SUBNETS_PER_VALIDATOR; i++) {
          this.subscribeToRandomSubnet(currentFork);
        }
      }
    }
    this.knownValidators.set(validatorIndex, currentSlot + LAST_SEEN_VALIDATOR_TIMEOUT);
  }

  /**
   * Subscribe to long-lived random subnets and update the local ENR bitfield.
   */
  private subscribeToRandomSubnet(fork: IForkName): void {
    const currentSlot = this.chain.clock.currentSlot;
    const allSubnets = Array.from({length: ATTESTATION_SUBNET_COUNT}, (_, i) => i);
    const activeSubnets = this.randomSubnets.getActive(currentSlot);
    const availableSubnets = allSubnets.filter((subnet) => !activeSubnets.includes(subnet));
    const toSubscribeSubnet = availableSubnets[randBetween(0, availableSubnets.length)];
    // the heartbeat will help connect to respective peers
    this.randomSubnets.request({
      subnetId: toSubscribeSubnet,
      toSlot: getSubscriptionSlotForRandomSubnet(this.config, currentSlot),
    });
    if (!this.subscribedCommitteeSubnets.getActive(currentSlot).includes(toSubscribeSubnet)) {
      // subscribe to topic
      this.gossip.subscribeTopic({type: GossipType.beacon_attestation, fork, subnet: toSubscribeSubnet});
    }
    // Update ENR
    const attnets = this.metadata.attnets;
    if (!attnets[toSubscribeSubnet]) {
      attnets[toSubscribeSubnet] = true;
      this.metadata.attnets = attnets;
    }
  }

  /**
   * Duplicate randomSubnets to nextForkRandomSubnets to make sure same ENR advertisement
   * Subscribe to respective gossip topics with next fork.
   * No need to update ENR
   * @param nextFork
   */
  private subscribeToNextForkRandomSubnets(nextFork: IForkName): void {
    const currentSlot = this.chain.clock.currentSlot;
    const activeSubnets = this.randomSubnets.getActive(currentSlot);
    for (const subnet of activeSubnets) {
      this.nextForkRandomSubnets!.request({
        subnetId: subnet,
        toSlot: getSubscriptionSlotForRandomSubnet(this.config, currentSlot),
      });
      this.gossip.subscribeTopic({type: GossipType.beacon_attestation, fork: nextFork, subnet});
    }
  }

  /**
   * Run per slot.
   */
  private onSlot = (slot: phase0.Slot): void => {
    try {
      const fork = this.chain.getForkName();
      if (fork !== this.randomSubnets.getForkName() && fork === this.nextForkRandomSubnets?.getForkName()) {
        this.transitionToNextFork();
      }
      this.handleRandomSubnetExpiry(slot);
      this.handleKnownValidatorExpiry(slot);
      this.handleUnsubscriptions(slot);
    } catch (e) {
      this.logger.error("Error running AttestationService at slot", {slot}, e);
    }
  };

  private transitionToNextFork(): void {
    const fork = this.chain.getForkName();
    assert.true(this.nextForkRandomSubnets !== undefined, "No next fork random subnets subscriptions");
    assert.equal(
      fork,
      this.nextForkRandomSubnets?.getForkName(),
      "Chain fork name is not same to next fork random subnet"
    );
    this.logger.info("Transitioning to next fork", fork);
    const currentSlot = this.chain.clock.currentSlot;
    const activeSubnets = this.nextForkRandomSubnets!.getActive(currentSlot);
    this.randomSubnets = new SubnetMap(fork);
    for (const subnet of activeSubnets) {
      this.randomSubnets.request({
        subnetId: subnet,
        toSlot: this.nextForkRandomSubnets?.getToSlot(subnet) as phase0.Slot,
      });
    }
    // assume 1 hard fork look ahead
    this.nextForkRandomSubnets = undefined;
  }

  /**
   * Subscribe to a committee subnet.
   */
  private handleSubscription(subnetId: number, slot: phase0.Slot): void {
    // Check if the subnet currently exists as a long-lasting random subnet
    const randomSubnetToSlot = this.randomSubnets.getToSlot(subnetId);
    const fork = this.chain.getForkName();
    if (randomSubnetToSlot && randomSubnetToSlot >= 0) {
      // just extend the expiry
      this.randomSubnets.request({subnetId, toSlot: slot});
    } else {
      // subscribe to topic
      this.gossip.subscribeTopic({type: GossipType.beacon_attestation, fork, subnet: subnetId});
    }
    this.subscribedCommitteeSubnets.request({subnetId, toSlot: slot});
  }

  /**
   * Unsubscribe to a committee subnet from subscribedCommitteeSubnets.
   * If a random subnet is present, we do not unsubscribe from it.
   */
  private handleUnsubscriptions(currentSlot: phase0.Slot): void {
    const inactiveSubscribedCommitteeSubnets = this.subscribedCommitteeSubnets.getInactive(currentSlot);
    const activeRandomSubnets = this.randomSubnets.getActive(currentSlot);
    const fork = this.subscribedCommitteeSubnets.getForkName();
    for (const subnet of inactiveSubscribedCommitteeSubnets) {
      if (!activeRandomSubnets.includes(subnet)) {
        this.gossip.unsubscribeTopic({type: GossipType.beacon_attestation, fork, subnet});
      }
    }
    const inactiveCommitteeSubnets = this.committeeSubnets.getInactive(currentSlot);
    // inactiveCommitteeSubnets is superset of inactiveSubscribedCommitteeSubnets
    for (const subnet of inactiveCommitteeSubnets) {
      this.committeeSubnets.prune(subnet);
      this.subscribedCommitteeSubnets.prune(subnet);
    }
  }

  /**
   * A random subnet has expired.
   * This function selects a new subnet to join, or extends the expiry if there are no more
   * available subnets to choose from.
   */
  private handleRandomSubnetExpiry(slot: phase0.Slot): void {
    const allRandomSubnets = this.randomSubnets.getAll();
    const inactiveRandomSubnets = this.randomSubnets.getInactive(slot);
    const currentFork = this.chain.getForkName();
    const randomSubnetFork = this.randomSubnets.getForkName();
    if (allRandomSubnets.length === ATTESTATION_SUBNET_COUNT) {
      // We are at capacity, simply increase the timeout of the current subnet
      for (const subnet of inactiveRandomSubnets) {
        // After the fork occurs, let the subnets from the previous fork reach the end of life with no replacements
        if (currentFork === randomSubnetFork) {
          this.randomSubnets.request({
            subnetId: subnet,
            toSlot: getSubscriptionSlotForRandomSubnet(this.config, slot),
          });
        } else {
          this.pruneRandomSubnet(subnet, slot);
        }
      }
      return;
    }
    for (const subnet of inactiveRandomSubnets) {
      this.pruneRandomSubnet(subnet, slot);
      // After the fork occurs, let the subnets from the previous fork reach the end of life with no replacements
      if (currentFork === randomSubnetFork) {
        this.subscribeToRandomSubnet(currentFork);
      }
    }
  }

  /**
   * A known validator has not sent a subscription in a while. They are considered offline and the
   * beacon node no longer needs to be subscribed to the allocated random subnets.
   *
   * We don't keep track of a specific validator to random subnet, rather the ratio of active
   * validators to random subnets. So when a validator goes offline, we can simply remove the
   * allocated amount of random subnets.
   */
  private handleKnownValidatorExpiry(currentSlot: phase0.Slot): void {
    const expiredValidators: Set<phase0.ValidatorIndex> = new Set();
    for (const [index, slot] of this.knownValidators.entries()) {
      if (currentSlot > slot) expiredValidators.add(index);
    }
    const numConnectedValidators = this.knownValidators.size - expiredValidators.size;
    if (numConnectedValidators * this.config.params.RANDOM_SUBNETS_PER_VALIDATOR >= ATTESTATION_SUBNET_COUNT) {
      // have too many validators
      for (const validator of expiredValidators) {
        this.knownValidators.delete(validator);
      }
      return;
    }

    const activeRandomSubnets = this.randomSubnets.getActive(currentSlot);

    for (const validator of expiredValidators) {
      for (let i = 0; i < this.config.params.RANDOM_SUBNETS_PER_VALIDATOR; i++) {
        const toRemoveSubnet = activeRandomSubnets[0];
        if (toRemoveSubnet >= 0) {
          this.pruneRandomSubnet(toRemoveSubnet, currentSlot);
        }
        this.knownValidators.delete(validator);
      }
    }
  }

  private pruneRandomSubnet(subnet: number, currentSlot: phase0.Slot): void {
    const activeSubscribedCommitteeSubnets = this.subscribedCommitteeSubnets.getActive(currentSlot);
    if (!activeSubscribedCommitteeSubnets.includes(subnet)) {
      const fork = this.randomSubnets.getForkName()!;
      this.gossip.unsubscribeTopic({type: GossipType.beacon_attestation, fork, subnet});
    }
    // Update ENR
    const attnets = this.metadata.attnets;
    if (attnets[subnet]) {
      attnets[subnet] = false;
      this.metadata.attnets = attnets;
    }
    this.randomSubnets.prune(subnet);
  }
}

function getSubscriptionSlotForRandomSubnet(config: IBeaconConfig, currentSlot: phase0.Slot): phase0.Slot {
  return (
    randBetween(
      config.params.EPOCHS_PER_RANDOM_SUBNET_SUBSCRIPTION,
      2 * config.params.EPOCHS_PER_RANDOM_SUBNET_SUBSCRIPTION
    ) *
      config.params.SLOTS_PER_EPOCH +
    currentSlot
  );
}
