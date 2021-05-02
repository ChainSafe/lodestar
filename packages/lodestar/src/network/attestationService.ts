import {computeEpochAtSlot, computeSubnetForCommitteesAtSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig, ForkName, IForkInfo} from "@chainsafe/lodestar-config";
import {ATTESTATION_SUBNET_COUNT, phase0, Slot, ValidatorIndex} from "@chainsafe/lodestar-types";
import {ILogger, randBetween} from "@chainsafe/lodestar-utils";
import {ChainEvent, IBeaconChain} from "../chain";
import {Eth2Gossipsub, GossipType} from "./gossip";
import {MetadataController} from "./metadata";
import {SubnetMap} from "./peers/utils";
import {getCurrentAndNextFork} from "./util";

/**
 * The time (in slots) before a last seen validator is considered absent and we unsubscribe from the random
 * gossip topics that we subscribed to due to the validator connection.
 */
const LAST_SEEN_VALIDATOR_TIMEOUT = 150;

export interface IAttestationService {
  addBeaconCommitteeSubscriptions(subscriptions: phase0.BeaconCommitteeSubscription[]): void;
  shouldProcessAttestation(subnet: number, slot: phase0.Slot): boolean;
  getActiveSubnets(): number[];
}

export interface IAttestationServiceModules {
  config: IBeaconConfig;
  chain: IBeaconChain;
  logger: ILogger;
  gossip: Eth2Gossipsub;
  metadata: MetadataController;
}

/**
 * Manage random (long lived) subnets and committee (short lived) subnets.
 */
export class AttestationService implements IAttestationService {
  private readonly config: IBeaconConfig;
  private readonly chain: IBeaconChain;
  private readonly gossip: Eth2Gossipsub;
  private readonly metadata: MetadataController;
  private readonly logger: ILogger;

  /** Map of random subnets and the slot until they are needed of current fork */
  private randomSubnets: SubnetMap;
  /** Map of random subnets and the slot until they are needed of next fork */
  private nextForkRandomSubnets: SubnetMap | null = null;
  /** Map of committee subnets and the slot until they are needed */
  private committeeSubnets: SubnetMap;
  /** subset of committeeSubnets with exact slot for aggregator */
  private subscribedCommitteeSubnets: SubnetMap;

  private nextForkSubscriptionTimer: NodeJS.Timeout | undefined;

  /**
   * A collection of seen validators. These dictate how many random subnets we should be
   * subscribed to. As these time out, we unsubscribe from the required random subnets and update our ENR.
   * This is a map of validator index and its last active slot.
   */
  private knownValidators = new Map<number, Slot>();

  constructor(modules: IAttestationServiceModules) {
    this.config = modules.config;
    this.chain = modules.chain;
    this.gossip = modules.gossip;
    this.metadata = modules.metadata;
    this.logger = modules.logger;
    const currentFork = this.chain.getHeadForkName();
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

  /**
   * Called from /eth/v1/validator/beacon_committee_subscriptions api when validator is an attester.
   */
  addBeaconCommitteeSubscriptions(subscriptions: phase0.BeaconCommitteeSubscription[] = []): void {
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
  shouldProcessAttestation(subnet: number, slot: Slot): boolean {
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
    if (nextFork && nextFork.epoch !== Infinity) {
      let waitingSlots =
        (nextFork.epoch - EPOCHS_PER_RANDOM_SUBNET_SUBSCRIPTION) * SLOTS_PER_EPOCH - this.chain.clock.currentSlot;
      if (waitingSlots < 0) {
        // we are probably less than EPOCHS_PER_RANDOM_SUBNET_SUBSCRIPTION to the next hardfork
        waitingSlots = 0;
      }
      this.logger.info("Preparing for the next fork random subnet subscriptions", {
        waitingSlots,
        nextFork: nextFork.name,
      });
      const timeToPreparedEpoch = waitingSlots * SECONDS_PER_SLOT * 1000;
      if (timeToPreparedEpoch > 0) {
        this.nextForkSubscriptionTimer = setTimeout(() => {
          this.subscribeToNextForkRandomSubnets(nextFork.name);
        }, timeToPreparedEpoch);
      }
    }
  }

  private getNextFork(): IForkInfo | undefined {
    const headEpoch = computeEpochAtSlot(this.config, this.chain.forkChoice.getHead().slot);
    const {nextFork} = getCurrentAndNextFork(this.config, headEpoch);
    return nextFork;
  }

  /**
   * Add validator to knownValidators list.
   */
  private addKnownValidator(validatorIndex: ValidatorIndex): void {
    this.knownValidators.set(validatorIndex, this.chain.clock.currentSlot + LAST_SEEN_VALIDATOR_TIMEOUT);
    this.rebalanceRandomSubnets();
  }

  /**
   * Subscribe to long-lived random subnets and update the local ENR bitfield.
   */
  private subscribeToRandomSubnets(fork: ForkName, count: number): void {
    const currentSlot = this.chain.clock.currentSlot;
    const allSubnets = Array.from({length: ATTESTATION_SUBNET_COUNT}, (_, i) => i);
    const toSubscribeSubnets = [];
    for (let i = 0; i < count; i++) {
      const activeSubnets = this.randomSubnets.getActive(currentSlot);
      if (activeSubnets.length >= ATTESTATION_SUBNET_COUNT) {
        this.logger.info("Reached max number of random subnet", {count, maxSubnet: ATTESTATION_SUBNET_COUNT});
        break;
      }
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
      toSubscribeSubnets.push(toSubscribeSubnet);
    }
    // Update ENR
    const attnets = this.metadata.attnets;
    let updateENR = false;
    for (const subnet of toSubscribeSubnets) {
      if (!attnets[subnet]) {
        attnets[subnet] = true;
        updateENR = true;
      }
    }
    if (updateENR) {
      this.metadata.attnets = attnets;
    }
  }

  /**
   * Duplicate randomSubnets to nextForkRandomSubnets to make sure same ENR advertisement
   * Subscribe to respective gossip topics with next fork.
   * No need to update ENR
   * @param nextFork
   */
  private subscribeToNextForkRandomSubnets(nextFork: ForkName): void {
    const currentSlot = this.chain.clock.currentSlot;
    const activeSubnets = this.randomSubnets.getActive(currentSlot);
    for (const subnet of activeSubnets) {
      if (this.nextForkRandomSubnets) {
        this.nextForkRandomSubnets.request({
          subnetId: subnet,
          toSlot: getSubscriptionSlotForRandomSubnet(this.config, currentSlot),
        });
        this.gossip.subscribeTopic({type: GossipType.beacon_attestation, fork: nextFork, subnet});
      }
    }
  }

  /**
   * Run per slot.
   */
  private onSlot = (slot: Slot): void => {
    try {
      this.handleRandomSubnetExpiry(slot);
      this.handleKnownValidatorExpiry(slot);
      this.handleUnsubscriptions(slot);
      this.transitionToNextForkMaybe();
    } catch (e) {
      this.logger.error("Error running AttestationService at slot", {slot}, e);
    }
  };

  private transitionToNextForkMaybe(): void {
    const fork = this.chain.getHeadForkName();
    if (
      !this.nextForkRandomSubnets ||
      fork === this.randomSubnets.forkName ||
      fork !== this.nextForkRandomSubnets.forkName
    ) {
      return;
    }

    this.logger.info("Transitioning to next fork", fork);
    const currentSlot = this.chain.clock.currentSlot;
    const activeSubnets = this.nextForkRandomSubnets.getActive(currentSlot);
    this.randomSubnets = new SubnetMap(fork);
    for (const subnet of activeSubnets) {
      this.randomSubnets.request({
        subnetId: subnet,
        toSlot: this.nextForkRandomSubnets?.getToSlot(subnet) as Slot,
      });
    }
    // assume 1 hard fork look ahead
    this.nextForkRandomSubnets = null;
  }

  /**
   * Subscribe to a committee subnet.
   */
  private handleSubscription(subnetId: number, slot: Slot): void {
    // Check if the subnet currently exists as a long-lasting random subnet
    const randomSubnetToSlot = this.randomSubnets.getToSlot(subnetId);
    const fork = this.chain.getHeadForkName();
    if (randomSubnetToSlot !== undefined) {
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
  private handleUnsubscriptions(currentSlot: Slot): void {
    const activeRandomSubnets = this.randomSubnets.getActive(currentSlot);
    const fork = this.subscribedCommitteeSubnets.forkName;
    for (const subnet of this.subscribedCommitteeSubnets.getExpired(currentSlot)) {
      if (!activeRandomSubnets.includes(subnet)) {
        this.gossip.unsubscribeTopic({type: GossipType.beacon_attestation, fork, subnet});
      }
    }
    const expiredCommitteeSubnets = this.committeeSubnets.getExpired(currentSlot);
    // expiredCommitteeSubnets is superset of expiredSubscribedCommitteeSubnets
    for (const subnet of expiredCommitteeSubnets) {
      this.committeeSubnets.delete(subnet);
      this.subscribedCommitteeSubnets.delete(subnet);
    }
  }

  /**
   * A random subnet has expired.
   * This function selects a new subnet to join, or extends the expiry if there are no more
   * available subnets to choose from.
   */
  private handleRandomSubnetExpiry(slot: Slot): void {
    const allRandomSubnets = this.randomSubnets.getAll();
    const expiredRandomSubnets = this.randomSubnets.getExpired(slot);
    const currentFork = this.chain.getHeadForkName();
    const randomSubnetFork = this.randomSubnets.forkName;
    if (allRandomSubnets.length === ATTESTATION_SUBNET_COUNT) {
      // We are at capacity, simply increase the timeout of the current subnet
      for (const subnet of expiredRandomSubnets) {
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
    let newRandomSubnets = 0;
    for (const subnet of expiredRandomSubnets) {
      this.pruneRandomSubnet(subnet, slot);
      // After the fork occurs, let the subnets from the previous fork reach the end of life with no replacements
      if (currentFork === randomSubnetFork) {
        newRandomSubnets = newRandomSubnets + 1;
      }
    }
    this.subscribeToRandomSubnets(currentFork, newRandomSubnets);
  }

  /**
   * A known validator has not sent a subscription in a while. They are considered offline and the
   * beacon node no longer needs to be subscribed to the allocated random subnets.
   *
   * We don't keep track of a specific validator to random subnet, rather the ratio of active
   * validators to random subnets. So when a validator goes offline, we can simply remove the
   * allocated amount of random subnets.
   */
  private handleKnownValidatorExpiry(currentSlot: Slot): void {
    for (const [index, slot] of this.knownValidators.entries()) {
      if (currentSlot > slot) this.knownValidators.delete(index);
    }
    this.rebalanceRandomSubnets();
  }

  /**
   * Called when we have new validators or expired validators.
   * knownValidators should be updated before this function.
   */
  private rebalanceRandomSubnets(): void {
    const {RANDOM_SUBNETS_PER_VALIDATOR} = this.config.params;
    const numValidators = this.knownValidators.size;
    // random subnet is renewed automatically
    let numRandomSubnets = this.randomSubnets.getAll().length;
    // subscribe to more random subnets
    const currentFork = this.chain.getHeadForkName();
    const targetRandomSubnetCount = numValidators * RANDOM_SUBNETS_PER_VALIDATOR;
    if (targetRandomSubnetCount > numRandomSubnets) {
      this.subscribeToRandomSubnets(currentFork, targetRandomSubnetCount - numRandomSubnets);
    }
    const currentSlot = this.chain.clock.currentSlot;
    const activeRandomSubnets = this.randomSubnets.getActive(currentSlot);
    let toRemoveIndex = 0;
    // unsubscribe some random subnets
    while (targetRandomSubnetCount < numRandomSubnets) {
      const toRemoveSubnet = activeRandomSubnets[toRemoveIndex++];
      if (toRemoveSubnet !== undefined) {
        this.pruneRandomSubnet(toRemoveSubnet, currentSlot);
      }
      numRandomSubnets = numRandomSubnets - 1;
    }
  }

  private pruneRandomSubnet(subnet: number, currentSlot: Slot): void {
    const activeSubscribedCommitteeSubnets = this.subscribedCommitteeSubnets.getActive(currentSlot);
    if (!activeSubscribedCommitteeSubnets.includes(subnet)) {
      const fork = this.randomSubnets.forkName;
      this.gossip.unsubscribeTopic({type: GossipType.beacon_attestation, fork, subnet});
    }
    // Update ENR
    const attnets = this.metadata.attnets;
    if (attnets[subnet]) {
      attnets[subnet] = false;
      this.metadata.attnets = attnets;
    }
    this.randomSubnets.delete(subnet);
  }
}

function getSubscriptionSlotForRandomSubnet(config: IBeaconConfig, currentSlot: Slot): Slot {
  return (
    randBetween(
      config.params.EPOCHS_PER_RANDOM_SUBNET_SUBSCRIPTION,
      2 * config.params.EPOCHS_PER_RANDOM_SUBNET_SUBSCRIPTION
    ) *
      config.params.SLOTS_PER_EPOCH +
    currentSlot
  );
}
