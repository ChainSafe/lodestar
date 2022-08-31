import {mkdir, rm} from "node:fs/promises";
import tmp from "tmp";
import {activePreset} from "@lodestar/params";
import {BeaconNodeProcess, SimulationOptionalParams, SimulationParams, SimulationRequiredParams} from "./types.js";
import {EpochClock} from "./EpochClock.js";
import {LodestarBeaconNodeProcess, defaultSimulationParams, getSimulationId} from "./index.js";

export class SimulationEnvironment {
  readonly params: SimulationParams;
  readonly id: string;
  readonly rootDir: string;
  readonly nodes: BeaconNodeProcess[] = [];
  readonly clock: EpochClock;
  readonly controller: AbortController;

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
    this.rootDir = `${tmp.dirSync({unsafeCleanup: true}).name}/${this.id}`;
    this.clock = new EpochClock({
      genesisTime,
      secondsPerSlot: this.params.secondsPerSlot,
      slotsPerEpoch: this.params.slotsPerEpoch,
      signal: this.controller.signal,
    });

    for (let i = 1; i <= this.params.beaconNodes; i += 1) {
      const nodeRootDir = `${this.rootDir}/node-${i}`;
      this.nodes.push(new LodestarBeaconNodeProcess(this.params, nodeRootDir));
    }
  }

  async start(): Promise<void> {
    await mkdir(this.rootDir);

    for (let i = 1; i <= this.params.beaconNodes; i += 1) {
      await this.nodes[i - 1].init();
    }

    await Promise.all(this.nodes.map((p) => p.start()));
  }

  async stop(): Promise<void> {
    this.controller.abort();
    await Promise.all(this.nodes.map((p) => p.stop()));
    await rm(this.rootDir, {recursive: true});
  }

  connectNodesToFirstNode(): void {
    const firstNode = this.nodes[0];
    for (let i = 1; i < this.params.beaconNodes; i += 1) {
      const node = this.nodes[i];
      node.connect(firstNode);
    }
  }
}
