import {mkdir, rm} from "node:fs/promises";
import tmp from "tmp";
import {BeaconNodeProcess, SimulationOptionalParams, SimulationParams, SimulationRequiredParams} from "./types.js";
import {LodestarBeaconNodeProcess, defaultSimulationParams, getSimulationId} from "./index.js";

export class SimulationEnvironment {
  readonly params: SimulationParams;
  readonly id: string;
  readonly rootDir: string;
  readonly nodes: BeaconNodeProcess[] = [];

  constructor(params: SimulationRequiredParams & Partial<SimulationOptionalParams>) {
    const paramsWithDefaults = {...defaultSimulationParams, ...params} as SimulationRequiredParams &
      SimulationOptionalParams;

    const genesisTime =
      Math.floor(Date.now() / 1000) + paramsWithDefaults.genesisSlotsDelay * paramsWithDefaults.secondsPerSlot;

    this.params = {
      ...paramsWithDefaults,
      genesisTime,
    } as SimulationParams;

    this.id = getSimulationId(this.params);
    this.rootDir = `${tmp.dirSync({unsafeCleanup: true}).name}/${this.id}`;
  }

  async start(): Promise<void> {
    await mkdir(this.rootDir);
    for (let i = 1; i <= this.params.beaconNodes; i += 1) {
      const nodeRootDir = `${this.rootDir}/node-${i}`;
      this.nodes.push(new LodestarBeaconNodeProcess(this.params, nodeRootDir));
      await this.nodes[i - 1].start();
    }
  }

  async stop(): Promise<void> {
    await Promise.all(this.nodes.map((p) => p.stop()));
    await rm(this.rootDir, {recursive: true});
  }
}
