import {BeaconChain, BeaconChainModules} from "../../src/chain/chain.js";
import {IChainOptions} from "../../src/chain/options.js";
import {StateInitialization} from "../../src/chain/stateInitialization.js";
import {executeStateInitialization} from "../../src/node/nodejs.js";
import {TestBeaconEngineModules, createTestBeaconEngine} from "./engine.js";

export type TestChainModules = TestBeaconEngineModules & {
  stateInitialization?: Pick<StateInitialization, "validate" | "log" | "shouldPersist">;
  pruneHotDbOnInit?: boolean;
};

export async function initializeTestChain(opts: IChainOptions, modules: TestChainModules): Promise<BeaconChainModules> {
  const dependencies = createTestBeaconEngine(opts, modules);
  const {beaconEngine} = dependencies;
  try {
    await executeStateInitialization(beaconEngine, {
      stateBytes: modules.anchorStateBytes,
      config: modules.config,
      isFinalized: modules.isAnchorStateFinalized,
      shouldPersist: false,
      validate: () => {},
      log: () => {},
      ...modules.stateInitialization,
    });
    if (modules.pruneHotDbOnInit) await modules.db.pruneHotDb();
    const anchor = await beaconEngine.initializeFromAnchor();
    return {...dependencies, anchor, builderApiClient: beaconEngine.builderApiClient};
  } catch (error) {
    dependencies.abortController.abort();
    await beaconEngine.close();
    throw error;
  }
}

export async function createBeaconChain(opts: IChainOptions, modules: TestChainModules): Promise<BeaconChain> {
  return new BeaconChain(opts, await initializeTestChain(opts, modules));
}
