import {
  NativeApplicationConfig,
  NativeLocalIntent,
  NativeNetworkApplicationRuntime,
  NativeSubscriptionSet,
} from "@chainsafe/lodestar-z/network";
import {
  ATTESTATION_SUBNET_COUNT,
  SLOTS_PER_EPOCH,
  SYNC_COMMITTEE_SUBNET_COUNT,
  isForkPostAltair,
  isForkPostFulu,
  isForkPostGloas,
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
import {kinds, nativeLocalState} from "./config.js";
import {NativeNetworkError, NativeNetworkErrorCode, nativeInteger} from "./errors.js";

type Desired = {
  status: Status;
  custodyGroupCount: number;
  coreTopics: boolean;
  custodyTopics: boolean;
  attDuties: Map<number, Set<number>>;
  attDemand: Map<number, number>;
  syncDuties: Map<number, number>;
};
type Change = (desired: Desired) => void;
type Update = {type: "intent"; change: Change} | {type: "status"; status: Status};
type Command = Update & {resolve: () => void; reject: (error: unknown) => void};

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

export function snapshotCommitteeSubscriptions(subscriptions: CommitteeSubscription[], sync: boolean) {
  nativeInteger(subscriptions.length, "committee subscriptions", 4096);
  return subscriptions.map(({slot, subnet, validatorIndex, isAggregator}) => {
    if (typeof isAggregator !== "boolean")
      throw new NativeNetworkError({code: NativeNetworkErrorCode.CONFIGURATION, resource: "aggregator flag"});
    return {
      slot: nativeInteger(slot, "duty slot", Number.MAX_SAFE_INTEGER - 1),
      subnet: nativeInteger(subnet, "duty subnet", (sync ? SYNC_COMMITTEE_SUBNET_COUNT : ATTESTATION_SUBNET_COUNT) - 1),
      validatorIndex: nativeInteger(validatorIndex, "validator index"),
      isAggregator,
    };
  });
}

export class NativeIntent {
  private desired: Desired;
  private readonly commands: Command[] = [];
  private busy = false;
  private dirty = false;
  private closed = false;
  private appliedSlot: number;
  constructor(
    private readonly runtime: Pick<NativeNetworkApplicationRuntime, "applyIntent" | "updateStatus">,
    private readonly application: NativeApplicationConfig,
    private readonly network: NetworkConfig,
    private readonly clock: IClock,
    private readonly opts: NetworkOptions,
    status: Status,
    private readonly onFailure: (error: unknown) => void
  ) {
    this.appliedSlot = Number(application.initialSlot);
    this.desired = {
      status: snapshotStatus(status),
      custodyGroupCount: network.custodyConfig.targetCustodyGroupCount,
      coreTopics: false,
      custodyTopics: false,
      attDuties: new Map(),
      attDemand: new Map(),
      syncDuties: new Map(),
    };
  }
  updateStatus(status: Status): Promise<void> {
    return this.enqueue({type: "status", status: snapshotStatus(status)});
  }
  coreTopics(enabled: boolean): Promise<void> {
    return this.enqueue({
      type: "intent",
      change: (state) => {
        state.coreTopics = enabled;
      },
    });
  }
  custody(count: number): Promise<void> {
    nativeInteger(count, "custody count", this.network.config.NUMBER_OF_CUSTODY_GROUPS, 1);
    return this.enqueue({
      type: "intent",
      change: (state) => {
        state.custodyGroupCount = count;
        state.custodyTopics = true;
      },
    });
  }
  committee(subscriptions: CommitteeSubscription[], sync: boolean): Promise<void> {
    const copies = snapshotCommitteeSubscriptions(subscriptions, sync);
    return this.enqueue({
      type: "intent",
      change: (state) => {
        for (const {slot, subnet, isAggregator} of copies) {
          if (sync) {
            state.syncDuties.set(subnet, Math.max(state.syncDuties.get(subnet) ?? 0, slot));
          } else {
            state.attDemand.set(subnet, Math.max(state.attDemand.get(subnet) ?? 0, slot + 1));
            if (isAggregator) {
              let subnets = state.attDuties.get(slot);
              if (!subnets) {
                if (state.attDuties.size >= 2 * SLOTS_PER_EPOCH)
                  throw new NativeNetworkError({
                    code: NativeNetworkErrorCode.CAPACITY,
                    resource: "aggregator duty slots",
                  });
                subnets = new Set();
                state.attDuties.set(slot, subnets);
              }
              subnets.add(subnet);
            }
          }
        }
      },
    });
  }
  refresh(): void {
    if (this.closed) return;
    this.dirty = true;
    this.start();
  }
  private enqueue(update: Update): Promise<void> {
    if (this.closed)
      return Promise.reject(new NativeNetworkError({code: NativeNetworkErrorCode.CLOSED, resource: "local intent"}));
    if (this.commands.length >= 16)
      return Promise.reject(
        new NativeNetworkError({code: NativeNetworkErrorCode.CAPACITY, resource: "local intent waiters"})
      );
    const completion = defer<void>();
    this.commands.push({...update, resolve: () => completion.resolve(), reject: completion.reject});
    this.start();
    return completion.promise;
  }
  private start(): void {
    if (this.busy || this.closed) return;
    this.busy = true;
    void this.run().finally(() => {
      this.busy = false;
      if (!this.closed && (this.commands.length || this.dirty)) setImmediate(() => this.start());
    });
  }
  private async run(): Promise<void> {
    for (let turn = 0; turn < 16 && !this.closed; turn++) {
      const command = this.commands.shift();
      if (!command && !this.dirty) return;
      const refresh = this.dirty;
      this.dirty = false;
      try {
        const slot = this.clock.currentSlot;
        if (command?.type === "status" && this.appliedSlot === slot && !refresh) {
          const status = nativeLocalState(
            this.network.config,
            command.status,
            slot,
            this.desired.custodyGroupCount
          ).status;
          await this.runtime.updateStatus(status);
          if (this.closed)
            throw new NativeNetworkError({code: NativeNetworkErrorCode.CLOSED, resource: "local intent"});
          this.desired.status = command.status;
        } else {
          const desired: Desired = {
            ...this.desired,
            attDuties: new Map(Array.from(this.desired.attDuties, ([slot, subnets]) => [slot, new Set(subnets)])),
            attDemand: new Map(this.desired.attDemand),
            syncDuties: new Map(this.desired.syncDuties),
          };
          for (const key of desired.attDuties.keys()) if (key < slot) desired.attDuties.delete(key);
          for (const [key, expiry] of desired.attDemand) if (expiry < slot) desired.attDemand.delete(key);
          const epochSlot = Math.floor(slot / SLOTS_PER_EPOCH) * SLOTS_PER_EPOCH;
          for (const [key, expiry] of desired.syncDuties) if (expiry < epochSlot) desired.syncDuties.delete(key);
          if (command?.type === "status") desired.status = command.status;
          else command?.change(desired);
          await this.runtime.applyIntent(this.render(desired, slot), BigInt(Math.max(0, slot)));
          if (this.closed)
            throw new NativeNetworkError({code: NativeNetworkErrorCode.CLOSED, resource: "local intent"});
          this.desired = desired;
          this.appliedSlot = slot;
        }
        if (slot !== this.clock.currentSlot) this.dirty = true;
        command?.resolve();
      } catch (error) {
        if (command) command.reject(error);
        else this.onFailure(error);
      }
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
      return !isForkPostGloas(boundary.fork) && (!next || epoch < next.epoch + FORK_EPOCH_LOOKAHEAD);
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
      for (const [dutySlot, subnets] of state.attDuties) {
        if (dutySlot >= slot && dutySlot <= slot + this.opts.slotsToSubscribeBeforeAggregatorDuty)
          for (const subnet of subnets) add({type: GossipType.beacon_attestation, subnet});
      }
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
        endpoints: this.application.discovery?.advertisement ?? null,
      },
      subscriptions,
      demand: {
        attnets,
        syncnets: local.metadata.syncnets,
        groupTargets,
        custodyGroupTargets,
        attestationTarget: Math.min(6, this.opts.maxPeers),
        syncTarget: Math.min(6, this.opts.maxPeers),
        expiresAtSlot: BigInt(Math.max(0, slot)) + 2n,
      },
    };
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.dirty = false;
    for (const command of this.commands)
      command.reject(new NativeNetworkError({code: NativeNetworkErrorCode.CLOSED, resource: "local intent"}));
    this.commands.length = 0;
    this.desired.attDuties.clear();
    this.desired.attDemand.clear();
    this.desired.syncDuties.clear();
  }
}
