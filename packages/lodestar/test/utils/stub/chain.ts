import {minimalConfig} from "@chainsafe/lodestar-config/minimal";
import {SinonSandbox, SinonStubbedInstance} from "sinon";
import {BeaconChain, ForkChoice} from "../../../src/chain";
import {BeaconMetrics} from "../../../src/metrics";
import {LocalClock} from "../../../src/chain/clock";
import {StateRegenerator} from "../../../src/chain/regen";
import {CheckpointStateCache, StateContextCache} from "../../../src/chain/stateCache";
import {testLogger} from "../logger";
import {StubbedBeaconDb} from "./beaconDb";
import {generateValidators} from "../validator";
import {phase0} from "@chainsafe/lodestar-types";
import {FAR_FUTURE_EPOCH} from "@chainsafe/lodestar-beacon-state-transition";

export class StubbedBeaconChain extends BeaconChain {
  forkChoice: SinonStubbedInstance<ForkChoice> & ForkChoice;
  stateCache: SinonStubbedInstance<StateContextCache> & StateContextCache;
  checkpointStateCache: SinonStubbedInstance<CheckpointStateCache> & CheckpointStateCache;
  clock: SinonStubbedInstance<LocalClock> & LocalClock;
  regen: SinonStubbedInstance<StateRegenerator> & StateRegenerator;

  constructor(sinon: SinonSandbox, config = minimalConfig) {
    super({
      opts: {},
      config,
      logger: testLogger(),
      metrics: sinon.createStubInstance(BeaconMetrics),
      db: new StubbedBeaconDb(sinon, config),
      anchorState: config.types.phase0.BeaconState.tree.createValue({
        ...config.types.phase0.BeaconState.defaultValue(),
        validators: generateValidators(64, {
          effectiveBalance: BigInt(config.params.MAX_EFFECTIVE_BALANCE),
          activationEpoch: 0,
          activationEligibilityEpoch: 0,
          withdrawableEpoch: FAR_FUTURE_EPOCH,
          exitEpoch: FAR_FUTURE_EPOCH,
        }),
        balances: Array.from({length: 64}, () => BigInt(0)),
      } as phase0.BeaconState),
    });
    this.forkChoice = sinon.createStubInstance(ForkChoice) as SinonStubbedInstance<ForkChoice> & ForkChoice;
    this.stateCache = sinon.createStubInstance(StateContextCache) as SinonStubbedInstance<StateContextCache> &
      StateContextCache;
    this.checkpointStateCache = sinon.createStubInstance(CheckpointStateCache) as SinonStubbedInstance<
      CheckpointStateCache
    > &
      CheckpointStateCache;
    this.clock = sinon.createStubInstance(LocalClock) as SinonStubbedInstance<LocalClock> & LocalClock;
    this.regen = sinon.createStubInstance(StateRegenerator) as SinonStubbedInstance<StateRegenerator> &
      StateRegenerator;
  }
}
