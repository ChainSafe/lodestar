import {minimalConfig} from "@chainsafe/lodestar-config/minimal";
import {SinonSandbox, SinonStubbedInstance} from "sinon";
import {BeaconChain, ForkChoice} from "../../../src/chain";
import {BeaconMetrics} from "../../../src/metrics";
import {LocalClock} from "../../../src/chain/clock";
import {StateRegenerator} from "../../../src/chain/regen";
import {CheckpointStateCache, StateContextCache} from "../../../src/chain/stateCache";
import {silentLogger} from "../logger";
import {StubbedBeaconDb} from "./beaconDb";

export class StubbedBeaconChain extends BeaconChain {
  public forkChoice: SinonStubbedInstance<ForkChoice> & ForkChoice;
  public stateCache: SinonStubbedInstance<StateContextCache> & StateContextCache;
  public checkpointStateCache: SinonStubbedInstance<CheckpointStateCache> & CheckpointStateCache;
  public clock: SinonStubbedInstance<LocalClock> & LocalClock;
  public regen: SinonStubbedInstance<StateRegenerator> & StateRegenerator;

  constructor(sinon: SinonSandbox, config = minimalConfig) {
    super({
      opts: {},
      config,
      logger: silentLogger,
      metrics: sinon.createStubInstance(BeaconMetrics),
      db: new StubbedBeaconDb(sinon, config),
      anchorState: config.types.BeaconState.tree.defaultValue(),
    });
    this.forkChoice = sinon.createStubInstance(ForkChoice) as any;
    this.stateCache = sinon.createStubInstance(StateContextCache) as any;
    this.checkpointStateCache = sinon.createStubInstance(CheckpointStateCache) as any;
    this.clock = sinon.createStubInstance(LocalClock) as any;
    this.regen = sinon.createStubInstance(StateRegenerator) as any;
  }
}
