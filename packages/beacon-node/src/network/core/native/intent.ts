import {
  NativeApplicationConfig,
  NativeLocalIntent,
  NativeNetwork,
  NativeSubscriptionSet,
} from "@chainsafe/lodestar-z/network";
import {
  ATTESTATION_SUBNET_COUNT,
  SLOTS_PER_EPOCH,
  SYNC_COMMITTEE_SUBNET_COUNT,
  isForkPostAltair,
  isForkPostFulu,
} from "@lodestar/params";
import {Status} from "@lodestar/types";
import {defer} from "@lodestar/utils";
import {TARGET_GROUP_PEERS_PER_SUBNET} from "../../../constants/network.js";
import {IClock} from "../../../util/clock.js";
import {CustodyConfig} from "../../../util/dataColumns.js";
import {FORK_EPOCH_LOOKAHEAD, getActiveForkBoundaries, getCurrentAndNextForkBoundary} from "../../forks.js";
import {GossipTopicTypeMap, GossipType} from "../../gossip/interface.js";
import {getCoreTopicsAtFork, getDataColumnSidecarTopics} from "../../gossip/topic.js";
import {NetworkConfig} from "../../networkConfig.js";
import {NetworkOptions} from "../../options.js";
import {CommitteeSubscription} from "../../subnets/interface.js";
import {computeSubscribedSubnet} from "../../subnets/util.js";
import {
  CommitteeDemand,
  committeeDemand,
  mergeCommitteeDemand,
  normalizeCommitteeSubscriptions,
  pruneCommitteeDemand,
} from "./committee.js";
import {kinds, nativeLocalState} from "./config.js";
import {NativeNetworkError, NativeNetworkErrorCode, nativeInteger} from "./errors.js";

type Desired = CommitteeDemand & {
  status: Status;
  custodyGroupCount: number;
  coreTopics: boolean;
  custodyTopics: boolean;
};
type Patch = {
  status?: Status;
  coreTopics?: boolean;
  custodyGroupCount?: number;
  committee?: CommitteeDemand;
};
type Batch = {patch: Patch; completion?: ReturnType<typeof defer<void>>};

function snapshotStatus(status: Status): Status {
  const copyRoot = (value: Uint8Array, length: number): Uint8Array => {
    if (!(value instanceof Uint8Array) || value.length !== length)
      throw new NativeNetworkError({code: NativeNetworkErrorCode.CONFIGURATION, resource: "status root length"});
    return Uint8Array.from(value);
  };
  return {
    forkDigest: copyRoot(status.forkDigest, 4),
    headRoot: copyRoot(status.headRoot, 32),
    finalizedRoot: copyRoot(status.finalizedRoot, 32),
    headSlot: nativeInteger(status.headSlot, "head slot"),
    finalizedEpoch: nativeInteger(status.finalizedEpoch, "finalized epoch"),
    ...("earliestAvailableSlot" in status
      ? {earliestAvailableSlot: nativeInteger(status.earliestAvailableSlot, "earliest available slot")}
      : {}),
  };
}

export class NativeIntent {
  private applied: Desired;
  private pending: (Batch & {completion: ReturnType<typeof defer<void>>}) | undefined;
  private active: Batch | undefined;
  private scheduled = false;
  private dirty = false;
  private closed = false;
  private appliedSlot: number;
  constructor(
    private readonly runtime: Pick<NativeNetwork, "applyIntent" | "updateStatus">,
    application: Pick<NativeApplicationConfig, "initialSlot">,
    private readonly network: NetworkConfig,
    private readonly clock: IClock,
    private readonly opts: NetworkOptions,
    status: Status,
    private readonly onFailure: (error: unknown) => void
  ) {
    this.appliedSlot = Number(application.initialSlot);
    this.applied = {
      status: snapshotStatus(status),
      custodyGroupCount: network.custodyConfig.targetCustodyGroupCount,
      coreTopics: false,
      custodyTopics: false,
      ...committeeDemand(),
    };
  }
  updateStatus(status: Status): Promise<void> {
    return this.enqueue({status: snapshotStatus(status)});
  }
  coreTopics(enabled: boolean): Promise<void> {
    return this.enqueue({coreTopics: enabled});
  }
  isSubscribedToCoreTopics(): boolean {
    return !this.closed && this.applied.coreTopics;
  }
  custody(count: number): Promise<void> {
    nativeInteger(count, "custody count", this.network.config.NUMBER_OF_CUSTODY_GROUPS, 1);
    return this.enqueue({custodyGroupCount: count});
  }
  committee(subscriptions: CommitteeSubscription[], sync: boolean): Promise<void> {
    return this.enqueue({
      committee: normalizeCommitteeSubscriptions(subscriptions, sync, this.clock, this.network.config),
    });
  }
  refresh(): void {
    if (this.closed) return;
    this.dirty = true;
    this.start();
  }
  /** Pending updates share completion; a newer value may replace an older one before submission. */
  private enqueue(patch: Patch): Promise<void> {
    if (this.closed)
      return Promise.reject(new NativeNetworkError({code: NativeNetworkErrorCode.CLOSED, resource: "local intent"}));
    this.pending ??= {patch: {}, completion: defer<void>()};
    const pending = this.pending;
    if (patch.committee && pending.patch.committee) {
      pruneCommitteeDemand(pending.patch.committee, this.clock.currentSlot, 2 * SLOTS_PER_EPOCH - 1);
      mergeCommitteeDemand(pending.patch.committee, patch.committee);
      patch.committee = pending.patch.committee;
    }
    Object.assign(pending.patch, patch);
    this.start();
    return pending.completion.promise;
  }
  private start(): void {
    if (this.active || this.scheduled || this.closed) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      if (this.closed || this.active || (!this.pending && !this.dirty)) return;
      const batch = this.pending ?? {patch: {}};
      const refresh = this.dirty;
      this.pending = undefined;
      this.dirty = false;
      this.active = batch;
      void this.run(batch, refresh).finally(() => {
        this.active = undefined;
        if (this.pending || this.dirty) this.start();
      });
    });
  }
  private async run(batch: Batch, refresh: boolean): Promise<void> {
    try {
      const {patch} = batch;
      const slot = this.clock.currentSlot;
      if (
        patch.status &&
        patch.coreTopics === undefined &&
        patch.custodyGroupCount === undefined &&
        !patch.committee &&
        this.appliedSlot === slot &&
        !refresh
      ) {
        const status = nativeLocalState(this.network.config, patch.status, slot, this.applied.custodyGroupCount).status;
        await this.runtime.updateStatus(status);
        if (this.closed) return;
        this.applied.status = patch.status;
      } else {
        const desired: Desired = {
          ...this.applied,
          attDuties: new Map(this.applied.attDuties),
          attDemand: new Map(this.applied.attDemand),
          syncDuties: new Map(this.applied.syncDuties),
        };
        if (patch.status) desired.status = patch.status;
        if (patch.coreTopics !== undefined) desired.coreTopics = patch.coreTopics;
        if (patch.committee) mergeCommitteeDemand(desired, patch.committee);
        if (patch.custodyGroupCount !== undefined) {
          desired.custodyGroupCount = patch.custodyGroupCount;
          desired.custodyTopics = true;
        }
        pruneCommitteeDemand(desired, slot);
        await this.runtime.applyIntent(this.render(desired, slot), BigInt(Math.max(0, slot)));
        if (this.closed) return;
        this.applied = desired;
        this.appliedSlot = slot;
      }
      if (slot !== this.clock.currentSlot) this.dirty = true;
      batch.completion?.resolve();
    } catch (error) {
      if (this.closed) return;
      if (batch.completion) batch.completion.reject(error);
      else this.onFailure(error);
    }
  }
  private render(state: Desired, slot: number): NativeLocalIntent {
    const {config, nodeId} = this.network;
    const custodyConfig = new CustodyConfig({config, nodeId, initialCustodyGroupCount: state.custodyGroupCount});
    const network = {...this.network, custodyConfig};
    const epoch = Math.floor(slot / SLOTS_PER_EPOCH);
    const local = nativeLocalState(config, state.status, slot, state.custodyGroupCount);
    const boundaries = getActiveForkBoundaries(config, epoch).filter((boundary) => {
      const next = getCurrentAndNextForkBoundary(config, boundary.epoch).nextBoundary;
      return !next || epoch < next.epoch + FORK_EPOCH_LOOKAHEAD;
    });
    const longLived = computeSubscribedSubnet(config, nodeId, Math.max(0, epoch));
    const attnets = new Uint8Array(8);
    for (const subnet of longLived) local.metadata.attnets[subnet >> 3] |= 1 << (subnet % 8);
    for (const subnet of longLived) attnets[subnet >> 3] |= 1 << (subnet % 8);
    for (const [subnet, expiry] of state.attDemand) if (expiry >= slot) attnets[subnet >> 3] |= 1 << (subnet % 8);
    if (this.opts.subscribeAllSubnets) attnets.fill(255);
    if (this.opts.subscribeAllSubnets) local.metadata.attnets.fill(255);
    for (const subnet of state.syncDuties.keys()) local.metadata.syncnets |= 1 << subnet;
    if (this.opts.subscribeAllSubnets) local.metadata.syncnets = (1 << SYNC_COMMITTEE_SUBNET_COUNT) - 1;
    const subscriptions: NativeSubscriptionSet[] = [];
    for (const boundary of boundaries) {
      const subnets: NativeSubscriptionSet["subnets"] = {};
      const add = (topic: GossipTopicTypeMap[GossipType]): void => {
        const kind = kinds.find((kind) => kind === topic.type);
        if (!kind)
          throw new NativeNetworkError({code: NativeNetworkErrorCode.CONFIGURATION, resource: `topic ${topic.type}`});
        const subnet = "subnet" in topic ? topic.subnet : 0;
        const bytes = Math.floor(nativeInteger(subnet, "subscription subnet", 127) / 8) + 1;
        let mask = subnets[kind];
        if (!mask || mask.length < bytes) {
          const expanded = new Uint8Array(bytes);
          if (mask) expanded.set(mask);
          subnets[kind] = mask = expanded;
        }
        mask[subnet >> 3] |= 1 << (subnet % 8);
      };
      subscriptions.push({digest: config.forkBoundary2ForkDigest(boundary), subnets});
      if (state.coreTopics)
        for (const type of getCoreTopicsAtFork(network, boundary.fork, {
          subscribeAllSubnets: false,
          disableLightClientServer: this.opts.disableLightClientServer,
        }))
          add(type);
      if (state.custodyTopics && isForkPostFulu(boundary.fork))
        for (const type of getDataColumnSidecarTopics(network)) add(type);
      if (this.opts.subscribeAllSubnets) {
        for (let subnet = 0; subnet < ATTESTATION_SUBNET_COUNT; subnet++)
          add({type: GossipType.beacon_attestation, subnet});
        if (isForkPostAltair(boundary.fork))
          for (let subnet = 0; subnet < SYNC_COMMITTEE_SUBNET_COUNT; subnet++)
            add({type: GossipType.sync_committee, subnet});
      }
      for (const subnet of longLived) add({type: GossipType.beacon_attestation, subnet});
      let aggregatorSubnets = 0n;
      for (const [dutySlot, mask] of state.attDuties) {
        if (dutySlot >= slot && dutySlot <= slot + this.opts.slotsToSubscribeBeforeAggregatorDuty)
          aggregatorSubnets |= mask;
      }
      for (let subnet = 0; subnet < ATTESTATION_SUBNET_COUNT; subnet++)
        if ((aggregatorSubnets & (1n << BigInt(subnet))) !== 0n) add({type: GossipType.beacon_attestation, subnet});
      if (isForkPostAltair(boundary.fork))
        for (const subnet of state.syncDuties.keys()) add({type: GossipType.sync_committee, subnet});
    }
    const groupTargets = new Uint16Array(128);
    const custodyGroupTargets = new Uint16Array(128);
    if (isForkPostFulu(config.getForkName(slot))) {
      groupTargets.fill(
        Math.min(TARGET_GROUP_PEERS_PER_SUBNET, this.opts.maxPeers),
        0,
        config.NUMBER_OF_CUSTODY_GROUPS
      );
      for (const group of custodyConfig.sampleGroups) {
        groupTargets[group] = Math.min(this.opts.targetGroupPeers, this.opts.maxPeers);
        custodyGroupTargets[group] = Math.min(2, this.opts.maxPeers);
      }
    }
    return {
      update: {
        local,
      },
      subscriptions,
      demand: {
        attnets,
        syncnets: local.metadata.syncnets,
        groupTargets,
        custodyGroupTargets,
        attestationTarget: Math.min(6, this.opts.maxPeers),
        syncTarget: Math.min(6, this.opts.maxPeers),
      },
    };
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.dirty = false;
    const error = new NativeNetworkError({code: NativeNetworkErrorCode.CLOSED, resource: "local intent"});
    this.active?.completion?.reject(error);
    this.pending?.completion?.reject(error);
    this.pending = undefined;
    this.applied.attDuties.clear();
    this.applied.attDemand.clear();
    this.applied.syncDuties.clear();
  }
}
