import EventEmitter from "node:events";
import path from "node:path";
import fs from "node:fs/promises";
import createDebug from "debug";
import {routes} from "@lodestar/api/beacon";
import {ChainForkConfig} from "@lodestar/config";
import {Epoch, Slot} from "@lodestar/types";
import {LoggerNode} from "@lodestar/logger/node";
import {isNullish} from "../../utils.js";
import {EpochClock} from "./epochClock.js";
import {
  Match,
  AtLeast,
  NodeId,
  NodePair,
  Assertion,
  AssertionError,
  SimulationReporter,
  StoreType,
  StoreTypes,
} from "./interfaces.js";
import {defaultAssertions} from "./assertions/defaults/index.js";
import {TableReporter} from "./tableReporter.js";
import {fetchBlock} from "./utils/network.js";

const debug = createDebug("lodestar:sim:tracker");

interface SimulationTrackerInitOptions {
  nodes: NodePair[];
  config: ChainForkConfig;
  clock: EpochClock;
  signal: AbortSignal;
  logger: LoggerNode;
  logsDir: string;
}

export enum SimulationTrackerEvent {
  Slot = "slot",
  Head = "head",
}

export type SimulationTrackerEvents = {
  [SimulationTrackerEvent.Slot]: {slot: Slot};
  [SimulationTrackerEvent.Head]: routes.events.EventData[routes.events.EventType.head];
};

export const getEventNameForNodePair = (nodePair: NodePair, event: SimulationTrackerEvent): string =>
  `sim:tracker:${event}:${nodePair.id}`;

const eventStreamEventMap = {
  [SimulationTrackerEvent.Head]: routes.events.EventType.head,
  [SimulationTrackerEvent.Slot]: routes.events.EventType.block,
};

type Stores = StoreTypes<typeof defaultAssertions> & StoreType<string, unknown>;

export function getStoresForAssertions<D extends Assertion[]>(stores: Stores, dependencies: D): StoreTypes<D> {
  const filterStores: Record<string, unknown> = {};

  for (const assertion of dependencies) {
    filterStores[assertion.id] = stores[assertion.id];
  }

  return filterStores as StoreTypes<D>;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch (_e) {
    return false;
  }
}

export class SimulationTracker {
  readonly emitter = new EventEmitter();
  readonly reporter: SimulationReporter<typeof defaultAssertions & StoreType<string, unknown>>;
  readonly logger: LoggerNode;
  readonly logsDir: string;

  private lastSeenSlot: Map<NodeId, Slot> = new Map();
  private slotCapture: Map<Slot, NodeId[]> = new Map();
  private signal: AbortSignal;
  private nodes: NodePair[];
  private clock: EpochClock;
  private forkConfig: ChainForkConfig;
  private running = false;

  private errors: AssertionError[] = [];
  private stores: Stores;
  private assertions: Assertion[];
  private assertionIdsMap: Record<string, boolean> = {};
  private constructor({signal, nodes, clock, config, logger, logsDir}: SimulationTrackerInitOptions) {
    this.signal = signal;
    this.nodes = nodes;
    this.clock = clock;
    this.forkConfig = config;
    this.logsDir = logsDir;
    this.logger = logger.child({module: "tracker"});

    this.stores = {} as StoreTypes<typeof defaultAssertions> & StoreType<string, unknown>;
    this.assertions = [] as Assertion[];
    this.reporter = new TableReporter({
      logger: this.logger.child({module: "reporter"}),
      clock: this.clock,
      forkConfig: this.forkConfig,
      nodes: this.nodes,
      stores: this.stores,
      errors: this.errors,
    });
  }

  static initWithDefaults(opts: SimulationTrackerInitOptions): SimulationTracker {
    const tracker = new SimulationTracker(opts);

    for (const assertion of defaultAssertions) {
      tracker.register(assertion);
    }

    return tracker;
  }

  once<K extends keyof SimulationTrackerEvents>(
    nodePair: NodePair,
    eventName: K,
    fn: (data: SimulationTrackerEvents[K]) => void
  ): void {
    if (this.nodes.indexOf(nodePair) < 0) {
      this.initEventStreamForNode(nodePair, [eventStreamEventMap[eventName]]);
    }

    this.emitter.once(getEventNameForNodePair(nodePair, eventName), fn);
  }

  on<K extends keyof SimulationTrackerEvents>(
    nodePair: NodePair,
    eventName: K,
    fn: (data: SimulationTrackerEvents[K]) => void
  ): void {
    if (this.nodes.indexOf(nodePair) < 0) {
      this.initEventStreamForNode(nodePair, [eventStreamEventMap[eventName]]);
    }
    this.emitter.on(getEventNameForNodePair(nodePair, eventName), fn);
  }

  off<K extends keyof SimulationTrackerEvents>(
    nodePair: NodePair,
    eventName: K,
    fn: (data: SimulationTrackerEvents[K]) => void
  ): void {
    this.emitter.off(getEventNameForNodePair(nodePair, eventName), fn);
  }

  private emit<K extends keyof SimulationTrackerEvents>(
    nodePair: NodePair,
    eventName: K,
    data: SimulationTrackerEvents[K]
  ): void {
    this.emitter.emit(getEventNameForNodePair(nodePair, eventName), data);
  }

  track(node: NodePair): void {
    debug("track", node.beacon.id);
    this.initDataForNode(node);
    this.initEventStreamForNode(node);
    this.nodes.push(node);
  }

  async start(): Promise<void> {
    debug("starting tracker");
    this.running = true;
    for (const node of this.nodes) {
      this.initEventStreamForNode(node);
    }
    this.reporter.bootstrap();

    // Start clock loop on current slot or genesis
    this.clockLoop(Math.max(this.clock.currentSlot, 0)).catch((e) => {
      this.logger.error("error on clockLoop", e);
    });
  }

  async stop(opts: {dumpStores: boolean}): Promise<void> {
    this.running = false;

    if (opts.dumpStores) {
      if (!(await pathExists(path.join(this.logsDir, "data"))))
        await fs.mkdir(path.join(this.logsDir, "data"), {recursive: true});

      for (const assertion of this.assertions) {
        if (!assertion.dump) continue;

        const data = await assertion.dump({
          fork: this.forkConfig.getForkName(this.clock.currentSlot),
          forkConfig: this.forkConfig,
          clock: this.clock,
          epoch: this.clock.currentEpoch,
          store: this.stores[assertion.id],
          slot: this.clock.currentSlot,
          nodes: this.nodes,
        });

        for (const filename of Object.keys(data)) {
          await fs.writeFile(path.join(this.logsDir, "data", filename), data[filename]);
        }
      }
    }
  }

  async clockLoop(slot: number): Promise<void> {
    while (this.running && !this.signal.aborted) {
      // Wait for 2/3 of the slot to consider it missed
      await this.clock.waitForStartOfSlot(slot + 2 / 3, slot > 0).catch((e) => {
        this.logger.error("error on waitForStartOfSlot", e);
      });
      this.reporter.progress(slot);
      slot++;
    }
  }

  getErrorCount(): number {
    return this.errors.length;
  }

  onSlot(slot: Slot, node: NodePair, cb: (slot: Slot) => void): void {
    this.emitter.once(`${node.beacon.id}:slot:${slot}`, cb);
  }

  register(assertion: Assertion): void {
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
      this.stores[assertion.id][node.beacon.id] = {};
    }
  }

  record(error: AtLeast<AssertionError, "slot" | "message" | "assertionId">): void {
    this.errors.push({
      ...error,
      epoch: error.epoch ?? this.clock.getEpochForSlot(error.slot),
      nodeId: error.nodeId ?? "N/A",
    });
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
    this.lastSeenSlot.set(node.beacon.id, 0);
    for (const assertion of this.assertions) {
      this.stores[assertion.id][node.beacon.id] = {};
    }
  }

  private async processOnBlock(
    event: routes.events.EventData[routes.events.EventType.block],
    node: NodePair
  ): Promise<void> {
    const slot = event.slot;
    const epoch = this.clock.getEpochForSlot(slot);
    const lastSeenSlot = this.lastSeenSlot.get(node.beacon.id);
    debug(`processing block node=${node.beacon.id} slot=${slot} lastSeenSlot=${lastSeenSlot}`);

    if (lastSeenSlot !== undefined && slot > lastSeenSlot) {
      this.lastSeenSlot.set(node.beacon.id, slot);
    } else {
      // We don't need to process old blocks
      return;
    }

    await this.processCapture({slot, epoch}, node);
    await this.processAssert({slot, epoch});

    this.emit(node, SimulationTrackerEvent.Slot, {slot});
  }

  private async processOnHead(
    event: routes.events.EventData[routes.events.EventType.head],
    node: NodePair
  ): Promise<void> {
    this.emit(node, SimulationTrackerEvent.Head, event);
  }

  private processOnFinalizedCheckpoint(
    _event: routes.events.EventData[routes.events.EventType.finalizedCheckpoint],
    _node: NodePair
  ): void {
    // TODO: Add checkpoint tracking
  }

  private async processCapture({slot, epoch}: {slot: Slot; epoch: Epoch}, node: NodePair): Promise<void> {
    debug(`processing capture node=${node.beacon.id} slot=${slot}`);

    // It is observed that sometimes block is received on the node event stream
    // But the http-api does not respond with the block
    // This is a workaround to fetch the block with retries
    const block = await fetchBlock(node, {slot, tries: 2, delay: 250, signal: this.signal});
    if (!block) {
      debug(`block could not be found node=${node.beacon.id} slot=${slot}`);
      // Incase of reorg the block may not be available
      return;
    }

    for (const assertion of this.assertions) {
      const match = assertion.match({
        slot,
        epoch,
        node,
        clock: this.clock,
        forkConfig: this.forkConfig,
        fork: this.forkConfig.getForkName(slot),
      });

      if (match & Match.None || !(match & Match.Capture)) continue;

      if (!assertion.capture) {
        throw new Error(`Assertion "${assertion.id}" has no capture function`);
      }

      const value = await assertion.capture({
        fork: this.forkConfig.getForkName(slot),
        slot,
        block,
        clock: this.clock,
        node,
        forkConfig: this.forkConfig,
        epoch,
        dependantStores: getStoresForAssertions(this.stores, [assertion, ...(assertion.dependencies ?? [])]),
      });

      if (!isNullish(value)) {
        this.stores[assertion.id][node.beacon.id][slot] = value;
      }
    }

    const capturedSlot = this.slotCapture.get(slot) ?? [];
    capturedSlot.push(node.beacon.id);
    this.slotCapture.set(slot, capturedSlot);
  }

  private async processAssert({slot, epoch}: {slot: Slot; epoch: Epoch}): Promise<void> {
    debug(`processing assert slot=${slot} epoch=${epoch}`);
    const capturedForNodes = this.slotCapture.get(slot);
    if (!capturedForNodes || capturedForNodes.length < this.nodes.length) {
      // We need to wait for all nodes to capture data for that slot
      return;
    }
    const removeAssertions: string[] = [];

    for (const node of this.nodes) {
      for (const assertion of this.assertions) {
        const match = assertion.match({
          slot,
          epoch,
          node,
          clock: this.clock,
          forkConfig: this.forkConfig,
          fork: this.forkConfig.getForkName(slot),
        });

        if (match & Match.None || !(match & Match.Assert)) continue;

        try {
          const errors = await assertion.assert({
            fork: this.forkConfig.getForkName(slot),
            slot,
            epoch,
            node,
            nodes: this.nodes,
            clock: this.clock,
            forkConfig: this.forkConfig,
            store: this.stores[assertion.id][node.beacon.id],
            dependantStores: getStoresForAssertions(this.stores, [assertion, ...(assertion.dependencies ?? [])]),
          });

          for (const err of errors) {
            const message = typeof err === "string" ? err : err[0];
            const data = typeof err === "string" ? {} : {...err[1]};
            this.errors.push({slot, epoch, assertionId: assertion.id, nodeId: node.beacon.id, message, data});
          }
        } catch (err: unknown) {
          this.errors.push({
            slot,
            epoch,
            nodeId: node.beacon.id,
            assertionId: assertion.id,
            message: (err as Error).message,
          });
        }
      }
    }

    for (const id of removeAssertions) {
      debug(`removing assertion slot=${slot} assertion=${id}`);
      delete this.assertionIdsMap[id];
      this.assertions = this.assertions.filter((a) => a.id !== id);
    }

    this.reporter.progress(slot);
  }

  private initEventStreamForNode(
    node: NodePair,
    events: routes.events.EventType[] = [
      routes.events.EventType.block,
      routes.events.EventType.head,
      routes.events.EventType.finalizedCheckpoint,
    ],
    signal?: AbortSignal
  ): void {
    debug("event stream initialized for", node.beacon.id);
    void node.beacon.api.events.eventstream({
      topics: events,
      signal: signal ?? this.signal,
      onEvent: async (event) => {
        switch (event.type) {
          case routes.events.EventType.block:
            debug(`block received node=${node.beacon.id} slot=${event.message.slot}`);
            await this.processOnBlock(event.message, node);
            return;
          case routes.events.EventType.head:
            await this.processOnHead(event.message, node);
            return;
          case routes.events.EventType.finalizedCheckpoint:
            this.processOnFinalizedCheckpoint(event.message, node);
            return;
        }
      },
    });
  }
}
