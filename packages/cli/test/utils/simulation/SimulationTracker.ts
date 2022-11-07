import EventEmitter from "node:events";
import {routes} from "@lodestar/api/beacon";
import {IChainForkConfig} from "@lodestar/config";
import {Epoch, Slot} from "@lodestar/types";
import {EpochClock} from "./EpochClock.js";
import {NodeId, NodePair, SimulationAssertion, SimulationAssertionError, StoreType, StoreTypes} from "./interfaces.js";
import {arrayGroupBy, avg, getForkName, squeezeString} from "./utils/index.js";
import {attestationsCountAssertion} from "./assertions/defaults/attestationCountAssertion.js";
import {attestationParticipationAssertion} from "./assertions/defaults/attestationParticipationAssertion.js";
import {connectedPeerCountAssertion} from "./assertions/defaults/connectedPeerCountAssertion.js";
import {finalizedAssertion} from "./assertions/defaults/finalizedAssertion.js";
import {headAssertion} from "./assertions/defaults/headAssertion.js";
import {inclusionDelayAssertion} from "./assertions/defaults/inclusionDelayAssertion.js";
import {missedBlocksAssertion} from "./assertions/defaults/missedBlocksAssertion.js";
import {syncCommitteeAssertion} from "./assertions/defaults/syncCommitteeAssertion.js";
import {TableRenderer} from "./TableRenderer.js";

const defaultAssertions = [
  inclusionDelayAssertion,
  attestationsCountAssertion,
  attestationParticipationAssertion,
  connectedPeerCountAssertion,
  finalizedAssertion,
  headAssertion,
  missedBlocksAssertion,
  syncCommitteeAssertion,
];

interface SimulationTrackerInitOptions {
  nodes: NodePair[];
  config: IChainForkConfig;
  clock: EpochClock;
  signal: AbortSignal;
}

/* eslint-disable no-console */
export class SimulationTracker {
  readonly emitter = new EventEmitter();
  table = new TableRenderer({
    fork: 10,
    eph: 5,
    slot: 4,
    head: 15,
    finalized: 10,
    peers: 6,
    attCount: 8,
    incDelay: 8,
    errors: 10,
  });

  private lastSeenSlot: Map<NodeId, Slot> = new Map();
  private slotCapture: Map<Slot, NodeId[]> = new Map();
  private removeAssertionQueue: string[] = [];
  private signal: AbortSignal;
  private nodes: NodePair[];
  private clock: EpochClock;
  private config: IChainForkConfig;

  private errors: SimulationAssertionError[] = [];
  private stores: StoreTypes<typeof defaultAssertions> & StoreType<string, unknown>;
  private assertions: SimulationAssertion[];
  private assertionIdsMap: Record<string, boolean> = {};

  private constructor({signal, nodes, clock, config}: SimulationTrackerInitOptions) {
    this.signal = signal;
    this.nodes = nodes;
    this.clock = clock;
    this.config = config;

    this.stores = {} as StoreTypes<typeof defaultAssertions> & StoreType<string, unknown>;
    this.assertions = [] as SimulationAssertion[];
  }

  static initWithDefaultAssertions(opts: SimulationTrackerInitOptions): SimulationTracker {
    const tracker = new SimulationTracker(opts);

    for (const assertion of defaultAssertions) {
      tracker.register(assertion);
    }

    return tracker;
  }

  track(node: NodePair): void {
    this.initDataForNode(node);
    this.initEventStreamForNode(node);
    this.nodes.push(node);
  }

  async start(): Promise<void> {
    for (const node of this.nodes) {
      this.initEventStreamForNode(node);
    }
    this.table.printHeader();
  }

  async stop(): Promise<void> {
    // Do nothing;
  }

  getErrorCount(): number {
    return this.errors.length;
  }

  onSlot(slot: Slot, node: NodePair, cb: (slot: Slot) => void): void {
    this.emitter.once(`${node.cl.id}:slot:${slot}`, cb);
  }

  register(assertion: SimulationAssertion): void {
    if (assertion.id in this.assertionIdsMap) {
      throw new Error(`The assertion "${assertion.id}" is already registered`);
    }

    for (const dep of assertion.dependencies ?? []) {
      if (dep.id in this.assertionIdsMap) continue;

      throw new Error(`The assertion "${assertion.id}" depends on "${dep.id}" which is not registered`);
    }

    this.assertions.push(assertion);
    this.assertionIdsMap[assertion.id] = true;

    this.stores[assertion.id] = {};
    for (const node of this.nodes) {
      this.stores[assertion.id][node.cl.id] = {};
    }
  }

  printTrackerInfo(slot: Slot): void {
    const epoch = this.clock.getEpochForSlot(slot);
    const forkName = getForkName(epoch, this.config);
    const epochStr = `${epoch}/${this.clock.getSlotIndexInEpoch(slot)}`;

    if (this.clock.isFirstSlotOfEpoch(slot)) {
      // We are printing this info for last epoch
      if (epoch - 1 < this.config.ALTAIR_FORK_EPOCH) {
        this.table.addEmptyRow("Att Participation: N/A - SC Participation: N/A");
      } else {
        // attestationParticipation is calculated at first slot of an epoch
        const participation = this.nodes.map((node) => this.stores["attestationParticipation"][node.cl.id][slot] ?? 0);
        const head = avg(participation.map((p) => p.head)).toFixed(2);
        const source = avg(participation.map((p) => p.source)).toFixed(2);
        const target = avg(participation.map((p) => p.target)).toFixed(2);

        // syncParticipation is calculated at last slot of an epoch so we subtract "slot -1"
        const syncParticipation = avg(
          this.nodes.map((node) => this.stores["syncCommitteeParticipation"][node.cl.id][slot - 1] ?? "-")
        ).toFixed(2);

        this.table.addEmptyRow(
          `Att Participation: H: ${head}, S: ${source}, T: ${target} - SC Participation: ${syncParticipation}`
        );
      }
    }

    const finalizedSlots = this.nodes.map((node) => this.stores["finalized"][node.cl.id][slot] ?? "-");
    const finalizedSlotsUnique = new Set(finalizedSlots);

    const inclusionDelay = this.nodes.map((node) => this.stores["inclusionDelay"][node.cl.id][slot] ?? "-");
    const inclusionDelayUnique = new Set(inclusionDelay);

    const attestationCount = this.nodes.map((node) => this.stores["attestationsCount"][node.cl.id][slot] ?? "-");
    const attestationCountUnique = new Set(attestationCount);

    const head = this.nodes.map((node) => this.stores["head"][node.cl.id][slot] ?? "-");
    const headUnique = new Set(head);

    const peerCount = this.nodes.map((node) => this.stores["connectedPeerCount"][node.cl.id][slot] ?? "-");
    const peerCountUnique = new Set(head);

    const errorCount = this.errors.filter((e) => e.slot === slot).length;

    this.table.addRow({
      fork: forkName,
      eph: epochStr,
      slot: slot,
      head: headUnique.size === 1 ? squeezeString(head[0], 12) : "different",
      finalized: finalizedSlotsUnique.size === 1 ? finalizedSlots[0] : finalizedSlots.join(","),
      peers: peerCountUnique.size === 1 ? peerCount[0] : peerCount.join(","),
      attCount: attestationCountUnique.size === 1 ? attestationCount[0] : "--",
      incDelay: inclusionDelayUnique.size === 1 ? inclusionDelay[0].toFixed(2) : inclusionDelay.join(","),
      errors: errorCount,
    });
  }

  printErrors(): void {
    console.log(`├${"─".repeat(10)} Errors (${this.errors.length}) ${"─".repeat(10)}┤`);

    const groupBySlot = arrayGroupBy(this.errors, (e) => String(e.slot as number));

    for (const [slot, slotErrors] of Object.entries(groupBySlot)) {
      if (slotErrors.length > 0) console.log(`├─ Slot: ${slot}`);
      const groupByAssertion = arrayGroupBy(slotErrors, (e) => e.assertionId);

      for (const [assertionId, assertionErrors] of Object.entries(groupByAssertion)) {
        if (assertionErrors.length > 0) console.log(`├── Assertion: ${assertionId}`);

        for (const error of assertionErrors) {
          console.error(`├──── ${error.message}`);
        }
      }
    }
  }

  private initDataForNode(node: NodePair): void {
    this.lastSeenSlot.set(node.cl.id, 0);
    for (const assertion of this.assertions) {
      this.stores[assertion.id][node.cl.id] = {};
    }
  }

  private async onBlock(event: routes.events.EventData[routes.events.EventType.block], node: NodePair): Promise<void> {
    const slot = event.slot;
    const epoch = this.clock.getEpochForSlot(slot);
    const lastSeenSlot = this.lastSeenSlot.get(node.cl.id);

    if (lastSeenSlot !== undefined && slot > lastSeenSlot) {
      this.lastSeenSlot.set(node.cl.id, slot);
    } else {
      // We don't need to process old blocks
      return;
    }

    const block = await node.cl.api.beacon.getBlockV2(slot);

    for (const assertion of this.assertions) {
      if (assertion.capture) {
        const value = await assertion.capture({
          fork: getForkName(epoch, this.config),
          slot,
          block: block.data,
          clock: this.clock,
          node,
          forkConfig: this.config,
          epoch,
          store: this.stores[assertion.id][node.cl.id],
          // TODO: Make the store safe, to filter just the dependant stores not all
          dependantStores: this.stores,
        });
        if (value !== undefined || value !== null) {
          this.stores[assertion.id][node.cl.id][slot] = value;
        }
      }
    }

    const capturedSlot = this.slotCapture.get(slot);
    if (capturedSlot) {
      capturedSlot.push(node.cl.id);
      this.slotCapture.set(slot, capturedSlot);
    } else {
      this.slotCapture.set(slot, [node.cl.id]);
    }

    await this.applyAssertions({slot, epoch});

    this.emitter.emit(`${node.cl.id}:slot:${slot}`, slot);
  }

  private onHead(_event: routes.events.EventData[routes.events.EventType.head], _node: NodePair): void {
    // TODO: Add head tracking
  }

  private onFinalizedCheckpoint(
    _event: routes.events.EventData[routes.events.EventType.finalizedCheckpoint],
    _node: NodePair
  ): void {
    // TODO: Add checkpoint tracking
  }

  private async applyAssertions({slot, epoch}: {slot: Slot; epoch: Epoch}): Promise<void> {
    const capturedForNodes = this.slotCapture.get(slot);
    if (!capturedForNodes || capturedForNodes.length < this.nodes.length) {
      // We need to wait for all nodes to capture data for that slot
      return;
    }

    for (const assertion of this.assertions) {
      const match = assertion.match({slot, epoch, clock: this.clock, forkConfig: this.config});
      if ((typeof match === "boolean" && match) || (typeof match === "object" && match.match)) {
        try {
          const errors = await assertion.assert({
            slot,
            epoch,
            nodes: this.nodes,
            clock: this.clock,
            forkConfig: this.config,
            store: this.stores[assertion.id],
            // TODO: Make the store safe, to filter just the dependant stores not all
            dependantStores: this.stores,
          });
          if (errors) {
            for (const err of errors) {
              this.errors.push({slot, epoch, assertionId: assertion.id, message: err});
            }
          }
        } catch (err: unknown) {
          this.errors.push({slot, epoch, assertionId: assertion.id, message: (err as Error).message});
        }
      }

      if (typeof match === "object" && match.remove) {
        this.removeAssertionQueue.push(assertion.id);
      }
    }

    this.printTrackerInfo(slot);
    this.processRemoveAssertionQueue();
  }

  private processRemoveAssertionQueue(): void {
    for (const id of this.removeAssertionQueue) {
      delete this.assertionIdsMap[id];
      this.assertions = this.assertions.filter((a) => a.id !== id);
    }
    this.removeAssertionQueue = [];
  }

  private initEventStreamForNode(node: NodePair): void {
    node.cl.api.events.eventstream(
      [routes.events.EventType.block, routes.events.EventType.head, routes.events.EventType.finalizedCheckpoint],
      this.signal,
      async (event) => {
        this.emitter.emit(event.type, event, node);

        switch (event.type) {
          case routes.events.EventType.block:
            await this.onBlock(event.message, node);
            return;
          case routes.events.EventType.finalizedCheckpoint:
            this.onFinalizedCheckpoint(event.message, node);
            return;
        }
      }
    );
  }
}
