import {computeSubnetForCommitteesAtSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ATTESTATION_SUBNET_COUNT, phase0} from "@chainsafe/lodestar-types";
import {randBetween} from "@chainsafe/lodestar-utils";
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
 * TODO: more logs
 */
export class AttestationService implements IAttestationService {
  private readonly config: IBeaconConfig;
  private readonly chain: IBeaconChain;
  private readonly gossip: Eth2Gossipsub;
  private readonly metadata: MetadataController;

  // Map of random subnets and the slot until they are needed
  private randomSubnets = new SubnetMap();
  // Map of committee subnets and the slot until they are needed
  private committeeSubnets = new SubnetMap();
  // subset of committeeSubnets if validator is an aggregator
  private subscribedCommitteeSubnets = new SubnetMap();

  /**
   * A collection of seen validators. These dictate how many random subnets we should be
   * subscribed to. As these time out, we unsubscribe for the required random subnets and update our ENR
   * This is a map of validator index and its expired slot.
   */
  private knownValidators = new Map<number, phase0.Slot>();

  constructor(modules: IAttestationServiceModules) {
    this.config = modules.config;
    this.chain = modules.chain;
    this.gossip = modules.gossip;
    this.metadata = modules.metadata;
  }

  start(): void {
    this.chain.emitter.on(ChainEvent.clockSlot, this.checkDuties);
  }

  stop(): void {
    this.chain.emitter.off(ChainEvent.clockSlot, this.checkDuties);
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
   * Add validator to knownValidators list.
   */
  private addKnownValidator(validatorIndex: phase0.ValidatorIndex): void {
    const currentSlot = this.chain.clock.currentSlot;
    if (!this.knownValidators.get(validatorIndex)) {
      if (this.randomSubnets.getActive(currentSlot).length < ATTESTATION_SUBNET_COUNT) {
        for (let i = 0; i < this.config.params.RANDOM_SUBNETS_PER_VALIDATOR; i++) {
          this.subscribeToRandomSubnet();
        }
      }
    }
    this.knownValidators.set(validatorIndex, currentSlot + LAST_SEEN_VALIDATOR_TIMEOUT);
  }

  /**
   * Subscribe to long-lived random subnets and update the local ENR bitfield.
   */
  private subscribeToRandomSubnet(): void {
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
      const fork = this.chain.getForkName();
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
   * Run per slot.
   */
  private checkDuties = (slot: phase0.Slot): void => {
    this.handleRandomSubnetExpiry(slot);
    this.handleKnownValidatorExpiry(slot);
    this.handleUnsubscriptions(slot);
  };

  /**
   * Subscribe to a committee subnet.
   */
  private handleSubscription(subnetId: number, slot: phase0.Slot): void {
    // Check if the subnet currently exists as a long-lasting random subnet
    const randomSubnetToSlot = this.randomSubnets.getToSlot(subnetId);
    if (randomSubnetToSlot && slot > randomSubnetToSlot) {
      // just extend the expiry
      this.randomSubnets.request({subnetId, toSlot: slot});
    } else {
      // subscribe to topic
      const fork = this.chain.getForkName();
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
    for (const subnet of inactiveSubscribedCommitteeSubnets) {
      if (!activeRandomSubnets.includes(subnet)) {
        const fork = this.chain.getForkName();
        // TODO: try catch
        // TODO: handle next fork
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
    if (allRandomSubnets.length === ATTESTATION_SUBNET_COUNT) {
      // We are at capacity, simply increase the timeout of the current subnet
      for (const subnet of inactiveRandomSubnets) {
        this.randomSubnets.request({subnetId: subnet, toSlot: getSubscriptionSlotForRandomSubnet(this.config, slot)});
      }
      return;
    }
    for (const subnet of inactiveRandomSubnets) {
      this.pruneRandomSubnet(subnet, slot);
      this.subscribeToRandomSubnet();
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

    for (const _ of expiredValidators) {
      for (let i = 0; i < this.config.params.RANDOM_SUBNETS_PER_VALIDATOR; i++) {
        const toRemoveSubnet = activeRandomSubnets[randBetween(0, activeRandomSubnets.length)];
        this.pruneRandomSubnet(toRemoveSubnet, currentSlot);
      }
    }
  }

  private pruneRandomSubnet(subnet: number, currentSlot: phase0.Slot): void {
    const activeSubscribedCommitteeSubnets = this.subscribedCommitteeSubnets.getActive(currentSlot);
    if (!activeSubscribedCommitteeSubnets.includes(subnet)) {
      const fork = this.chain.getForkName();
      // TODO: try catch
      // TODO: handle next fork
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
