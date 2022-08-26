import {mkdir, rm} from "node:fs/promises";
import tmp from "tmp";
import {ChainEvent} from "@lodestar/beacon-node/chain";
import {BeaconNodeProcess, SimulationOptionalParams, SimulationParams, SimulationRequiredParams} from "./types.js";
import {LodestarBeaconNodeProcess, defaultSimulationParams, getSimulationId} from "./index.js";

export class SimulationEnvironment {
  readonly params: SimulationParams;
  readonly id: string;
  readonly rootDir: string;

  private nodes: BeaconNodeProcess[] = [];

  constructor(params: SimulationRequiredParams & Partial<SimulationOptionalParams>) {
    const paramsWithDefaults = {...defaultSimulationParams, ...params} as SimulationRequiredParams &
      SimulationOptionalParams;

    // Should reach justification in 3 epochs max, and finalization in 4 epochs max
    const expectedEpochsToFinish = params.chainEvent === ChainEvent.justified ? 3 : 4;
    const genesisTime =
      Math.floor(Date.now() / 1000) + paramsWithDefaults.genesisSlotsDelay * paramsWithDefaults.secondsPerSlot;

    const expectedTimeout =
      ((paramsWithDefaults.epochsOfMargin + expectedEpochsToFinish) * paramsWithDefaults.slotsPerEpoch +
        paramsWithDefaults.genesisSlotsDelay) *
      paramsWithDefaults.secondsPerSlot *
      1000;

    this.params = {
      ...paramsWithDefaults,
      genesisTime,
      expectedTimeout,
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
