import EventEmitter from "node:events";
import {routes} from "@lodestar/api/beacon";
import {IChainForkConfig} from "@lodestar/config";
import {Epoch, Slot} from "@lodestar/types";
import {EpochClock} from "./EpochClock.js";
import {
  AtLeast,
  NodeId,
  NodePair,
  SimulationAssertion,
  SimulationAssertionError,
  SimulationReporter,
  StoreType,
  StoreTypes,
} from "./interfaces.js";
import {defaultAssertions} from "./assertions/defaults/index.js";
import {TableReporter} from "./TableReporter.js";

interface SimulationTrackerInitOptions {
  nodes: NodePair[];
  config: IChainForkConfig;
  clock: EpochClock;
  signal: AbortSignal;
}

/* eslint-disable no-console */
export class SimulationTracker {
  readonly emitter = new EventEmitter();
  readonly reporter: SimulationReporter<typeof defaultAssertions & StoreType<string, unknown>>;

  private lastSeenSlot: Map<NodeId, Slot> = new Map();
  private slotCapture: Map<Slot, NodeId[]> = new Map();
  private removeAssertionQueue: string[] = [];
  private signal: AbortSignal;
  private nodes: NodePair[];
  private clock: EpochClock;
  private forkConfig: IChainForkConfig;

  private errors: SimulationAssertionError[] = [];
  private stores: StoreTypes<typeof defaultAssertions> & StoreType<string, unknown>;
  private assertions: SimulationAssertion[];
  private assertionIdsMap: Record<string, boolean> = {};
  private constructor({signal, nodes, clock, config}: SimulationTrackerInitOptions) {
    this.signal = signal;
    this.nodes = nodes;
    this.clock = clock;
    this.forkConfig = config;

    this.stores = {} as StoreTypes<typeof defaultAssertions> & StoreType<string, unknown>;
    this.assertions = [] as SimulationAssertion[];
    this.reporter = new TableReporter({
      clock: this.clock,
      forkConfig: this.forkConfig,
      nodes: this.nodes,
      stores: this.stores,
      errors: this.errors,
    });
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
    this.reporter.bootstrap();
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

  record(error: AtLeast<SimulationAssertionError, "slot" | "message" | "assertionId">): void {
    this.errors.push({...error, epoch: error.epoch ?? this.clock.getEpochForSlot(error.slot)});
  }

  async assert(message: string, cb: () => void | Promise<void>): Promise<void> {
    try {
      await cb();
    } catch (error) {
      this.record({
        assertionId: message,
        message: (error as Error).message,
        slot: this.clock.currentSlot,
      });
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

    try {
      const block = await node.cl.api.beacon.getBlockV2(slot);

      for (const assertion of this.assertions) {
        if (assertion.capture) {
          const value = await assertion.capture({
            fork: this.forkConfig.getForkName(slot),
            slot,
            block: block.data,
            clock: this.clock,
            node,
            forkConfig: this.forkConfig,
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
    } catch {
      // Incase of reorg the block may not be available
      return;
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

  private async onHead(event: routes.events.EventData[routes.events.EventType.head], node: NodePair): Promise<void> {
    this.emitter.emit(`head:change:${node.cl.id}`, event);
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
      const match = assertion.match({slot, epoch, clock: this.clock, forkConfig: this.forkConfig});
      if ((typeof match === "boolean" && match) || (typeof match === "object" && match.match)) {
        try {
          const errors = await assertion.assert({
            slot,
            epoch,
            nodes: this.nodes,
            clock: this.clock,
            forkConfig: this.forkConfig,
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

  private initEventStreamForNode(
    node: NodePair,
    events: routes.events.EventType[] = [
      routes.events.EventType.block,
      routes.events.EventType.head,
      routes.events.EventType.finalizedCheckpoint,
    ]
  ): void {
    node.cl.api.events.eventstream(events, this.signal, async (event) => {
      this.emitter.emit(event.type, event, node);

      switch (event.type) {
        case routes.events.EventType.block:
          await this.onBlock(event.message, node);
          return;
        case routes.events.EventType.finalizedCheckpoint:
          this.onFinalizedCheckpoint(event.message, node);
          return;
      }
    });
  }
}
