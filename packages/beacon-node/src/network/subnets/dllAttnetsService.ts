import {
  ATTESTATION_SUBNET_COUNT,
  EPOCHS_PER_RANDOM_SUBNET_SUBSCRIPTION,
  ForkName,
  SLOTS_PER_EPOCH,
} from "@lodestar/params";
import {Epoch, Slot, ssz} from "@lodestar/types";
import {Logger, MapDef} from "@lodestar/utils";
import {BeaconConfig} from "@lodestar/config";
import {ClockEvent, IClock} from "../../util/clock.js";
import {GossipType} from "../gossip/index.js";
import {MetadataController} from "../metadata.js";
import {SubnetMap, RequestedSubnet} from "../peers/utils/index.js";
import {getActiveForks} from "../forks.js";
import {NetworkCoreMetrics} from "../core/metrics.js";
import {stringifyGossipTopic} from "../gossip/topic.js";
import {GOSSIP_D_LOW} from "../gossip/scoringParameters.js";
import {IAttnetsService, CommitteeSubscription, SubnetsServiceOpts, GossipSubscriber, NodeId} from "./interface.js";
import {computeSubscribedSubnet} from "./util.js";

const gossipType = GossipType.beacon_attestation;

enum SubnetSource {
  committee = "committee",
  longLived = "long_lived",
}

type Subnet = number;
// map of subnet to time to form stable mesh as seconds, null if not yet formed
type AggregatorDutyInfo = Map<Subnet, number | null>;

/**
 * This value means node is not able to form stable mesh.
 */
const NOT_ABLE_TO_FORM_STABLE_MESH_SEC = -1;

/**
 * Manage deleterministic long lived (DLL) subnets and short lived subnets.
 * - PeerManager uses attnetsService to know which peers are required for duties and long lived subscriptions
 * - Network call addCommitteeSubscriptions() from API calls
 * - Gossip handler checks shouldProcess to know if validator is aggregator
 */
export class DLLAttnetsService implements IAttnetsService {
  /** Committee subnets - PeerManager must find peers for those */
  private committeeSubnets = new SubnetMap();
  /**
   * All currently subscribed short-lived subnets, for attestation aggregation
   * This class will tell gossip to subscribe and un-subscribe
   * If a value exists for `SubscriptionId` it means that gossip subscription is active in network.gossip
   */
  private shortLivedSubscriptions = new SubnetMap();
  /** ${SUBNETS_PER_NODE} long lived subscriptions, may overlap with `shortLivedSubscriptions` */
  private longLivedSubscriptions = new Set<number>();
  /**
   * Map of an aggregator at a slot and AggregatorDutyInfo
   * Used to determine if we should process an attestation.
   */
  private aggregatorSlotSubnet = new MapDef<Slot, AggregatorDutyInfo>(() => new Map());

  constructor(
    private readonly config: BeaconConfig,
    private readonly clock: IClock,
    private readonly gossip: GossipSubscriber,
    private readonly metadata: MetadataController,
    private readonly logger: Logger,
    private readonly metrics: NetworkCoreMetrics | null,
    private readonly nodeId: NodeId | null,
    private readonly opts: SubnetsServiceOpts
  ) {
    // if subscribeAllSubnets, we act like we have >= ATTESTATION_SUBNET_COUNT validators connecting to this node
    // so that we have enough subnet topic peers, see https://github.com/ChainSafe/lodestar/issues/4921
    if (this.opts.subscribeAllSubnets) {
      for (let subnet = 0; subnet < ATTESTATION_SUBNET_COUNT; subnet++) {
        this.committeeSubnets.request({subnet, toSlot: Infinity});
      }
    }

    if (metrics) {
      metrics.attnetsService.longLivedSubscriptions.addCollect(() => this.onScrapeLodestarMetrics(metrics));
    }
    this.recomputeLongLivedSubnets();
    this.clock.on(ClockEvent.slot, this.onSlot);
    this.clock.on(ClockEvent.epoch, this.onEpoch);
  }

  close(): void {
    this.clock.off(ClockEvent.slot, this.onSlot);
    this.clock.off(ClockEvent.epoch, this.onEpoch);
  }

  /**
   * Get all active subnets for the hearbeat:
   *   - committeeSubnets so that submitted attestations can be spread to the network
   *  - longLivedSubscriptions because other peers based on this node's ENR for their submitted attestations
   */
  getActiveSubnets(): RequestedSubnet[] {
    const shortLivedSubnets = this.committeeSubnets.getActiveTtl(this.clock.currentSlot);

    const longLivedSubscriptionsToSlot =
      (Math.floor(this.clock.currentEpoch / EPOCHS_PER_RANDOM_SUBNET_SUBSCRIPTION) + 1) *
      EPOCHS_PER_RANDOM_SUBNET_SUBSCRIPTION *
      SLOTS_PER_EPOCH;
    const longLivedSubnets = Array.from(this.longLivedSubscriptions).map((subnet) => ({
      subnet,
      toSlot: longLivedSubscriptionsToSlot,
    }));

    // could be overlap, PeerDiscovery will handle it
    return [...shortLivedSubnets, ...longLivedSubnets];
  }

  /**
   * Called from the API when validator is a part of a committee.
   */
  addCommitteeSubscriptions(subscriptions: CommitteeSubscription[]): void {
    for (const {subnet, slot, isAggregator} of subscriptions) {
      // the peer-manager heartbeat will help find the subnet
      this.committeeSubnets.request({subnet, toSlot: slot + 1});
      if (isAggregator) {
        // need exact slot here
        this.aggregatorSlotSubnet.getOrDefault(slot).set(subnet, null);
      }
    }
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

  /**
   * TODO-dll: clarify how many epochs before the fork we should subscribe to the new fork
   * Call ONLY ONCE: Two epoch before the fork, re-subscribe all existing random subscriptions to the new fork
   **/
  subscribeSubnetsToNextFork(nextFork: ForkName): void {
    this.logger.info("Suscribing to long lived attnets to next fork", {
      nextFork,
      subnets: Array.from(this.longLivedSubscriptions).join(","),
    });
    for (const subnet of this.longLivedSubscriptions) {
      this.gossip.subscribeTopic({type: gossipType, fork: nextFork, subnet});
    }
  }

  /**
   * TODO-dll: clarify how many epochs after the fork we should unsubscribe to the new fork
   * Call  ONLY ONCE: Two epochs after the fork, un-subscribe all subnets from the old fork
   **/
  unsubscribeSubnetsFromPrevFork(prevFork: ForkName): void {
    this.logger.info("Unsuscribing to long lived attnets from prev fork", {prevFork});
    for (let subnet = 0; subnet < ATTESTATION_SUBNET_COUNT; subnet++) {
      if (!this.opts.subscribeAllSubnets) {
        this.gossip.unsubscribeTopic({type: gossipType, fork: prevFork, subnet});
      }
    }
  }

  /**
   * Run per slot.
   * - Subscribe to gossip subnets 2 slots in advance
   * - Unsubscribe from expired subnets
   * - Track time to stable mesh if not yet formed
   */
  private onSlot = (clockSlot: Slot): void => {
    try {
      setTimeout(
        () => {
          this.onHalfSlot(clockSlot);
        },
        this.config.SECONDS_PER_SLOT * 0.5 * 1000
      );

      for (const [dutiedSlot, dutiedInfo] of this.aggregatorSlotSubnet.entries()) {
        if (dutiedSlot === clockSlot + this.opts.slotsToSubscribeBeforeAggregatorDuty) {
          // Trigger gossip subscription first, in batch
          if (dutiedInfo.size > 0) {
            this.subscribeToSubnets(Array.from(dutiedInfo.keys()), SubnetSource.committee);
          }
          // Then, register the subscriptions
          for (const subnet of dutiedInfo.keys()) {
            this.shortLivedSubscriptions.request({subnet, toSlot: dutiedSlot});
          }
        }
        this.trackTimeToStableMesh(clockSlot, dutiedSlot, dutiedInfo);
      }

      this.unsubscribeExpiredCommitteeSubnets(clockSlot);
      this.pruneExpiredAggregator(clockSlot);
    } catch (e) {
      this.logger.error("Error on AttnetsService.onSlot", {slot: clockSlot}, e as Error);
    }
  };

  private onHalfSlot = (clockSlot: Slot): void => {
    for (const [dutiedSlot, dutiedInfo] of this.aggregatorSlotSubnet.entries()) {
      this.trackTimeToStableMesh(clockSlot, dutiedSlot, dutiedInfo);
    }
  };

  /**
   * Track time to form stable mesh if not yet formed
   */
  private trackTimeToStableMesh(clockSlot: Slot, dutiedSlot: Slot, dutiedInfo: AggregatorDutyInfo): void {
    if (dutiedSlot < clockSlot) {
      // aggregator duty is expired, set timeToStableMesh to some big value so we know this value is not good
      for (const [subnet, timeToFormMesh] of dutiedInfo.entries()) {
        if (timeToFormMesh === null) {
          dutiedInfo.set(subnet, NOT_ABLE_TO_FORM_STABLE_MESH_SEC);
          this.metrics?.attnetsService.subscriptionsCommitteeTimeToStableMesh.observe(
            {subnet},
            NOT_ABLE_TO_FORM_STABLE_MESH_SEC
          );
        }
      }
    } else if (dutiedSlot <= clockSlot + this.opts.slotsToSubscribeBeforeAggregatorDuty) {
      // aggregator duty is not expired, track time to stable mesh if this is the 1st time we see mesh peers>=Dlo (6)
      for (const [subnet, timeToFormMesh] of dutiedInfo.entries()) {
        if (timeToFormMesh === null) {
          const topicStr = stringifyGossipTopic(this.config, {
            type: gossipType,
            fork: this.config.getForkName(dutiedSlot),
            subnet,
          });
          const numMeshPeers = this.gossip.mesh.get(topicStr)?.size ?? 0;
          if (numMeshPeers >= GOSSIP_D_LOW) {
            const timeToStableMeshSec = this.clock.secFromSlot(
              dutiedSlot - this.opts.slotsToSubscribeBeforeAggregatorDuty
            );
            // set to dutiedInfo so we'll not set to metrics again
            dutiedInfo.set(subnet, timeToStableMeshSec);
            this.metrics?.attnetsService.subscriptionsCommitteeTimeToStableMesh.observe({subnet}, timeToStableMeshSec);
          }
        }
      }
    }
  }

  /**
   * Run per epoch, clean-up operations that are not urgent
   * Subscribe to new random subnets every EPOCHS_PER_RANDOM_SUBNET_SUBSCRIPTION epochs
   */
  private onEpoch = (epoch: Epoch): void => {
    try {
      if (epoch % EPOCHS_PER_RANDOM_SUBNET_SUBSCRIPTION === 0) {
        this.recomputeLongLivedSubnets();
      }
    } catch (e) {
      this.logger.error("Error on AttnetsService.onEpoch", {epoch}, e as Error);
    }
  };

  private recomputeLongLivedSubnets(): void {
    if (this.nodeId === null) {
      this.logger.verbose("Cannot recompute long-lived subscriptions, no nodeId");
      return;
    }

    const oldSubnets = this.longLivedSubscriptions;
    const newSubnets = computeSubscribedSubnet(this.nodeId, this.clock.currentEpoch);
    this.logger.verbose("Recomputing long-lived subscriptions", {
      epoch: this.clock.currentEpoch,
      oldSubnets: Array.from(oldSubnets).join(","),
      newSubnets: newSubnets.join(","),
    });

    const toRemoveSubnets = [];
    for (const subnet of oldSubnets) {
      if (!newSubnets.includes(subnet)) {
        toRemoveSubnets.push(subnet);
      }
    }

    // First, tell gossip to subscribe to the subnets if not connected already
    this.subscribeToSubnets(newSubnets, SubnetSource.longLived);

    // then update longLivedSubscriptions
    for (const subnet of toRemoveSubnets) {
      this.longLivedSubscriptions.delete(subnet);
    }

    for (const subnet of newSubnets) {
      //  this.longLivedSubscriptions is a set so it'll handle duplicates
      this.longLivedSubscriptions.add(subnet);
    }

    // Only tell gossip to unsubsribe last, longLivedSubscriptions has the latest state
    this.unsubscribeSubnets(toRemoveSubnets, this.clock.currentSlot, SubnetSource.longLived);
    this.updateMetadata();
  }

  /**
   * Unsubscribe to a committee subnet from subscribedCommitteeSubnets.
   * If a random subnet is present, we do not unsubscribe from it.
   */
  private unsubscribeExpiredCommitteeSubnets(slot: Slot): void {
    const expired = this.shortLivedSubscriptions.getExpired(slot);
    if (expired.length > 0) {
      this.unsubscribeSubnets(expired, slot, SubnetSource.committee);
    }
  }

  /**
   * No need to track aggregator for past slots.
   * @param currentSlot
   */
  private pruneExpiredAggregator(currentSlot: Slot): void {
    for (const dutiedSlot of this.aggregatorSlotSubnet.keys()) {
      if (currentSlot > dutiedSlot) {
        this.aggregatorSlotSubnet.delete(dutiedSlot);
      }
    }
  }

  /** Update ENR */
  private updateMetadata(): void {
    const subnets = ssz.phase0.AttestationSubnets.defaultValue();
    for (const subnet of this.longLivedSubscriptions) {
      subnets.set(subnet, true);
    }

    // Only update metadata if necessary, setting `metadata.[key]` triggers a write to disk
    if (!ssz.phase0.AttestationSubnets.equals(subnets, this.metadata.attnets)) {
      this.metadata.attnets = subnets;
    }
  }

  /**
   * Trigger a gossip subcription only if not already subscribed
   * shortLivedSubscriptions or longLivedSubscriptions should be updated right AFTER this called
   **/
  private subscribeToSubnets(subnets: number[], src: SubnetSource): void {
    const forks = getActiveForks(this.config, this.clock.currentEpoch);
    for (const subnet of subnets) {
      if (!this.shortLivedSubscriptions.has(subnet) && !this.longLivedSubscriptions.has(subnet)) {
        for (const fork of forks) {
          this.gossip.subscribeTopic({type: gossipType, fork, subnet});
        }
        this.metrics?.attnetsService.subscribeSubnets.inc({subnet, src});
      }
    }
  }

  /**
   * Trigger a gossip un-subscription only if no-one is still subscribed
   * If unsubscribe long lived subnets, longLivedSubscriptions should be updated right BEFORE this called
   **/
  private unsubscribeSubnets(subnets: number[], slot: Slot, src: SubnetSource): void {
    // No need to unsubscribeTopic(). Return early to prevent repetitive extra work
    if (this.opts.subscribeAllSubnets) return;

    const forks = getActiveForks(this.config, this.clock.currentEpoch);
    for (const subnet of subnets) {
      if (!this.shortLivedSubscriptions.isActiveAtSlot(subnet, slot) && !this.longLivedSubscriptions.has(subnet)) {
        for (const fork of forks) {
          this.gossip.unsubscribeTopic({type: gossipType, fork, subnet});
        }
        this.metrics?.attnetsService.unsubscribeSubnets.inc({subnet, src});
      }
    }
  }

  private onScrapeLodestarMetrics(metrics: NetworkCoreMetrics): void {
    metrics.attnetsService.committeeSubnets.set(this.committeeSubnets.size);
    metrics.attnetsService.subscriptionsCommittee.set(this.shortLivedSubscriptions.size);
    // track short lived subnet status, >= 6 (Dlo) means healthy, otherwise unhealthy
    const currentSlot = this.clock.currentSlot;
    for (const {subnet} of this.shortLivedSubscriptions.getActiveTtl(currentSlot)) {
      const topicStr = stringifyGossipTopic(this.config, {
        type: gossipType,
        fork: this.config.getForkName(currentSlot),
        subnet,
      });
      const numMeshPeers = this.gossip.mesh.get(topicStr)?.size ?? 0;
      metrics.attnetsService.subscriptionsCommitteeMeshPeers.observe({subnet}, numMeshPeers);
    }
    metrics.attnetsService.longLivedSubscriptions.set(this.longLivedSubscriptions.size);
    let aggregatorCount = 0;
    for (const subnets of this.aggregatorSlotSubnet.values()) {
      aggregatorCount += subnets.size;
    }
    metrics.attnetsService.aggregatorSlotSubnetCount.set(aggregatorCount);
  }
}
