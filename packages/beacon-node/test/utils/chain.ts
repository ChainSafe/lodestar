import assert from "node:assert/strict";
import {
  computeEpochAtSlot,
  readBeaconStateBytesMetadata,
  scanActiveValidatorsFromStateBytes,
} from "@lodestar/state-transition";
import {BeaconEngineMode} from "../../src/chain/beaconEngine/options.js";
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
  const metadata = readBeaconStateBytesMetadata(modules.anchorStateBytes);
  assert(metadata !== null, "Anchor state metadata must be readable");
  const activeValidators = scanActiveValidatorsFromStateBytes(
    modules.anchorStateBytes,
    modules.config.getForkTypes(metadata.slot).BeaconState,
    computeEpochAtSlot(metadata.slot)
  );
  assert(activeValidators !== null, "Anchor state validators must be readable");
  const dependencies = createTestBeaconEngine(opts, modules);
  const {beaconEngine} = dependencies;
  try {
    await dependencies.beaconEngineCore.init();
    const {earliestAvailableSlot} = await executeStateInitialization(beaconEngine, {
      stateBytes: modules.anchorStateBytes,
      activeValidatorCount: activeValidators.activeValidatorCount,
      config: modules.config,
      isFinalized: modules.isAnchorStateFinalized,
      shouldPersist: false,
      validate: () => {},
      initializeEarliestAvailableSlot: async (anchor) => {
        const floor = modules.earliestAvailableSlot ?? anchor.slot;
        await modules.db.earliestAvailableSlot.set(floor);
        return floor;
      },
      log: () => {},
      ...modules.stateInitialization,
    });
    if (modules.pruneHotDbOnInit) await modules.db.pruneHotDb();
    const anchor = await beaconEngine.initializeFromAnchor();
    return {
      ...dependencies,
      anchor,
      earliestAvailableSlot,
      builderApiClient:
        (opts.beaconEngineMode ?? BeaconEngineMode.MainThread) !== BeaconEngineMode.MainThread
          ? undefined
          : dependencies.beaconEngineCore.builderApiClient,
    };
  } catch (error) {
    dependencies.abortController.abort();
    await beaconEngine.close();
    throw error;
  }
}

export async function createBeaconChain(opts: IChainOptions, modules: TestChainModules): Promise<BeaconChain> {
  return new BeaconChain(opts, await initializeTestChain(opts, modules));
}
