import {defaultTopicScoreParams} from "@libp2p/gossipsub/score";
import {
  NativeApplicationConfig,
  NativeLocalIntent,
  NativeNetworkApplicationRuntime,
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
import {GossipType} from "../../gossip/interface.js";
import {computeGossipPeerScoreParams} from "../../gossip/scoringParameters.js";
import {getCoreTopicsAtFork, getDataColumnSidecarTopics, stringifyGossipTopic} from "../../gossip/topic.js";
import {NetworkConfig} from "../../networkConfig.js";
import {NetworkOptions} from "../../options.js";
import {CommitteeSubscription} from "../../subnets/interface.js";
import {computeSubscribedSubnet} from "../../subnets/util.js";
import {nativeLocalState, nativeTopicScore} from "./config.js";
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
  private appliedSlot: number | null = null;
  constructor(
    private readonly runtime: Pick<NativeNetworkApplicationRuntime, "applyIntent" | "updateStatus">,
    private readonly application: NativeApplicationConfig,
    private readonly network: NetworkConfig,
    private readonly clock: IClock,
    private readonly opts: NetworkOptions,
    private readonly activeValidatorCount: number,
    status: Status,
    private readonly onFailure: (error: unknown) => void
  ) {
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
  activate(status: Status, custodyGroupCount: number): Promise<void> {
    const copy = snapshotStatus(status);
    return this.enqueue({
      type: "intent",
      change: (state) => {
        state.status = copy;
        state.custodyGroupCount = custodyGroupCount;
      },
    });
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
        if (command?.type === "status" && this.appliedSlot === null)
          throw new NativeNetworkError({
            code: NativeNetworkErrorCode.UNAVAILABLE,
            resource: "local intent not activated",
          });
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
    const score = computeGossipPeerScoreParams({
      config,
      eth2Context: {activeValidatorCount: this.activeValidatorCount, currentEpoch: epoch, currentSlot: slot},
    });
    const topics = new Set<string>();
    for (const boundary of boundaries) {
      if (state.coreTopics)
        for (const type of getCoreTopicsAtFork(network, boundary.fork, {
          subscribeAllSubnets: false,
          disableLightClientServer: this.opts.disableLightClientServer,
        }))
          topics.add(stringifyGossipTopic(config, {...type, boundary}));
      if (state.custodyTopics && isForkPostFulu(boundary.fork))
        for (const type of getDataColumnSidecarTopics(network))
          topics.add(stringifyGossipTopic(config, {...type, boundary}));
      if (this.opts.subscribeAllSubnets) {
        for (let subnet = 0; subnet < ATTESTATION_SUBNET_COUNT; subnet++)
          topics.add(stringifyGossipTopic(config, {type: GossipType.beacon_attestation, subnet, boundary}));
        if (isForkPostAltair(boundary.fork))
          for (let subnet = 0; subnet < SYNC_COMMITTEE_SUBNET_COUNT; subnet++)
            topics.add(stringifyGossipTopic(config, {type: GossipType.sync_committee, subnet, boundary}));
      }
      for (const subnet of longLived)
        topics.add(stringifyGossipTopic(config, {type: GossipType.beacon_attestation, subnet, boundary}));
      for (const [dutySlot, subnets] of state.attDuties) {
        if (dutySlot >= slot && dutySlot <= slot + this.opts.slotsToSubscribeBeforeAggregatorDuty)
          for (const subnet of subnets)
            topics.add(stringifyGossipTopic(config, {type: GossipType.beacon_attestation, subnet, boundary}));
      }
      if (isForkPostAltair(boundary.fork))
        for (const subnet of state.syncDuties.keys())
          topics.add(stringifyGossipTopic(config, {type: GossipType.sync_committee, subnet, boundary}));
    }
    if (topics.size > 512)
      throw new NativeNetworkError({code: NativeNetworkErrorCode.CAPACITY, resource: "active gossip topics"});
    const groupTargets = Array<number>(128).fill(0);
    if (isForkPostFulu(config.getForkName(slot))) {
      groupTargets.fill(
        Math.min(TARGET_GROUP_PEERS_PER_SUBNET, this.opts.maxPeers),
        0,
        config.NUMBER_OF_CUSTODY_GROUPS
      );
      for (const group of custodyConfig.sampleGroups)
        groupTargets[group] = Math.min(this.opts.targetGroupPeers, this.opts.maxPeers);
    }
    return {
      update: {
        local,
        endpoints: this.application.discovery?.advertisement ?? null,
      },
      subscriptions: Array.from(topics, (name) => ({
        name,
        params: nativeTopicScore(score.topics?.[name] ?? {...defaultTopicScoreParams, topicWeight: 0}),
      })),
      demand: {
        attnets,
        syncnets: local.metadata.syncnets,
        groupTargets,
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
