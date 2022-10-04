import {mkdir, rm} from "node:fs/promises";
import {join} from "node:path";
import {EventEmitter} from "node:events";
import tmp from "tmp";
import {activePreset, MAX_COMMITTEES_PER_SLOT} from "@lodestar/params";
import {routes} from "@lodestar/api/beacon";
import {Slot} from "@lodestar/types";
import {BeaconNodeProcess, SimulationOptionalParams, SimulationParams, SimulationRequiredParams} from "./types.js";
import {EpochClock} from "./EpochClock.js";
import {SimulationTracker} from "./SimulationTracker.js";
import {LodestarBeaconNodeProcess, defaultSimulationParams, getSimulationId} from "./index.js";

export class SimulationEnvironment {
  readonly params: SimulationParams;
  readonly id: string;
  readonly rootDir: string;
  readonly nodes: BeaconNodeProcess[] = [];
  readonly clock: EpochClock;
  readonly expectedMinParticipationRate = 0.95;
  readonly expectedMaxInclusionDelay = 2;
  readonly expectedMinAttestationCount = MAX_COMMITTEES_PER_SLOT - 1;
  readonly expectedMinSyncParticipationRate = 0.95;
  readonly tracker: SimulationTracker;
  readonly emitter: EventEmitter;
  readonly controller: AbortController;

  readonly network = {
    connectAllNodes: async (): Promise<void> => {
      for (let i = 0; i < this.params.beaconNodes; i += 1) {
        for (let j = 0; j < this.params.beaconNodes; j += 1) {
          const peerId = this.nodes[j].peerId;

          if (i === j || !peerId) continue;

          await this.nodes[i].api.lodestar.connectPeer(peerId, this.nodes[j].multiaddrs);
        }
      }
    },
    connectNodesToFirstNode: async (): Promise<void> => {
      const firstNode = this.nodes[0];

      if (!firstNode.peerId) throw Error("First node must be started");

      for (let i = 1; i < this.params.beaconNodes; i += 1) {
        const node = this.nodes[i];
        await node.api.lodestar.connectPeer(firstNode.peerId, firstNode.multiaddrs);
      }
    },
  };

  constructor(params: SimulationRequiredParams & Partial<SimulationOptionalParams>) {
    const paramsWithDefaults = {...defaultSimulationParams, ...params} as SimulationRequiredParams &
      SimulationOptionalParams;

    const genesisTime =
      Math.floor(Date.now() / 1000) + paramsWithDefaults.genesisSlotsDelay * paramsWithDefaults.secondsPerSlot;

    this.params = {
      ...paramsWithDefaults,
      genesisTime,
      slotsPerEpoch: activePreset.SLOTS_PER_EPOCH,
    } as SimulationParams;

    this.controller = new AbortController();
    this.id = getSimulationId(this.params);
    this.rootDir = join(tmp.dirSync({unsafeCleanup: true}).name, this.id);
    this.clock = new EpochClock({
      genesisTime,
      secondsPerSlot: this.params.secondsPerSlot,
      slotsPerEpoch: this.params.slotsPerEpoch,
      signal: this.controller.signal,
    });
    this.emitter = new EventEmitter();

    for (let i = 1; i <= this.params.beaconNodes; i += 1) {
      const nodeRootDir = `${this.rootDir}/node-${i}`;
      this.nodes.push(new LodestarBeaconNodeProcess(this.params, nodeRootDir));
    }

    this.tracker = new SimulationTracker(this.nodes, this.clock, this.params, this.controller.signal);
  }

  async start(): Promise<this> {
    await mkdir(this.rootDir);
    await Promise.all(this.nodes.map((p) => p.start()));
    await this.tracker.start();
    return this;
  }

  async stop(): Promise<void> {
    this.controller.abort();
    await this.tracker.stop();
    await Promise.all(this.nodes.map((p) => p.stop()));
    await rm(this.rootDir, {recursive: true});
  }

  // TODO: Add timeout support
  waitForEvent(event: routes.events.EventType, node?: BeaconNodeProcess): Promise<routes.events.BeaconEvent> {
    console.log(`Waiting for event "${event}" on "${node?.id ?? "any node"}"`);

    return new Promise((resolve) => {
      const handler = (beaconEvent: routes.events.BeaconEvent, eventNode: BeaconNodeProcess): void => {
        if (!node) {
          this.emitter.removeListener(event, handler);
          resolve(beaconEvent);
        }

        if (node && eventNode === node) {
          this.emitter.removeListener(event, handler);
          resolve(beaconEvent);
        }
      };

      this.tracker.emitter.addListener(event, handler);
    });
  }

  async waitForSlot(slot: Slot, nodes?: BeaconNodeProcess[]): Promise<void> {
    console.log(`\nWaiting for slot on "${nodes ? nodes.map((n) => n.id).join(",") : "all nodes"}"`, {
      target: slot,
      current: this.clock.currentSlot,
    });

    await Promise.all(
      (nodes ?? this.nodes).map(
        (node) =>
          new Promise((resolve) => {
            this.tracker.onSlot(slot, node, resolve);
          })
      )
    );
  }
}
