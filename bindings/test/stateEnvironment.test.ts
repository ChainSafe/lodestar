import {Worker} from "node:worker_threads";
import {computeDomain} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {describe, expect, it} from "vitest";
import {SecretKey} from "../src/blst.js";
import bindings from "../src/index.js";
import type {EnvironmentScenario} from "./fixtures/stateEnvironment.js";
import {createStfState, stfConfig} from "./stfFixture.js";

function createState() {
  const config = new bindings.BeaconConfig(stfConfig, new Uint8Array(32));
  bindings.pubkeys.ensureCapacity(16);
  const bytes = ssz.fulu.BeaconState.serialize(createStfState());
  return {bytes, config, state: bindings.BeaconStateView.createFromBytes(bytes, config)};
}

function signedExit() {
  const seed = new Uint8Array(32);
  seed[0] = 1;
  const message = {epoch: stfConfig.FULU_FORK_EPOCH, validatorIndex: 0};
  const domain = computeDomain(new Uint8Array([4, 0, 0, 0]), stfConfig.CAPELLA_FORK_VERSION, new Uint8Array(32));
  const signingRoot = ssz.phase0.SigningData.hashTreeRoot({
    domain,
    objectRoot: ssz.phase0.VoluntaryExit.hashTreeRoot(message),
  });
  return {message, signature: SecretKey.fromKeygen(seed).sign(signingRoot).toBytes()};
}

describe("state environment ownership", () => {
  it("keeps distinct configurations independent", () => {
    const first = new bindings.BeaconConfig(stfConfig, new Uint8Array(32));
    const second = new bindings.BeaconConfig(stfConfig, new Uint8Array(32).fill(1));
    bindings.pubkeys.ensureCapacity(16);
    const bytes = ssz.fulu.BeaconState.serialize(createStfState());
    expect(bindings.BeaconStateView.createFromBytes(bytes, second).getVoluntaryExitValidity(signedExit(), true)).toBe(
      "invalid_signature"
    );
    expect(bindings.BeaconStateView.createFromBytes(bytes, first).getVoluntaryExitValidity(signedExit(), true)).toBe(
      "valid"
    );
  });

  it("copies configuration inputs for states and their descendants", () => {
    const chainConfig = {...stfConfig, CAPELLA_FORK_VERSION: stfConfig.CAPELLA_FORK_VERSION.slice()};
    const genesisRoot = new Uint8Array(32);
    const config = new bindings.BeaconConfig(chainConfig, genesisRoot);
    bindings.pubkeys.ensureCapacity(16);
    const bytes = ssz.fulu.BeaconState.serialize(createStfState());
    const state = bindings.BeaconStateView.createFromBytes(bytes, config);
    const exit = signedExit();
    expect(state.getVoluntaryExitValidity(exit, true)).toBe("valid");
    chainConfig.FULU_FORK_EPOCH = Infinity;
    chainConfig.CAPELLA_FORK_VERSION.fill(255);
    genesisRoot.fill(1);

    expect(state.getVoluntaryExitValidity(exit, true)).toBe("valid");
    expect(bindings.BeaconStateView.createFromBytes(bytes, config).getVoluntaryExitValidity(exit, true)).toBe("valid");
    const loaded = state.loadOtherState(bytes);
    const advanced = state.processSlots(state.slot + 1);
    expect(loaded.forkSeq).toBe(6);
    expect(advanced.forkSeq).toBe(6);
    expect(loaded.getVoluntaryExitValidity(exit, true)).toBe("valid");
    expect(advanced.getVoluntaryExitValidity(exit, true)).toBe("valid");
  });

  it("copies the genesis root before configuration getters can detach it", () => {
    const genesisRoot = new Uint8Array(32);
    const config = new bindings.BeaconConfig(
      Object.defineProperty({...stfConfig}, "CONFIG_NAME", {
        get() {
          structuredClone(genesisRoot, {transfer: [genesisRoot.buffer]});
          return "detached-root";
        },
      }),
      genesisRoot
    );
    expect(genesisRoot.byteLength).toBe(0);
    bindings.pubkeys.ensureCapacity(16);
    const state = bindings.BeaconStateView.createFromBytes(ssz.fulu.BeaconState.serialize(createStfState()), config);
    expect(state.getVoluntaryExitValidity(signedExit(), true)).toBe("valid");
  });

  it("keeps state configuration alive after its configuration wrapper is collected", async () => {
    bindings.pubkeys.ensureCapacity(16);
    const state = bindings.BeaconStateView.createFromBytes(
      ssz.fulu.BeaconState.serialize(createStfState()),
      new bindings.BeaconConfig(stfConfig, new Uint8Array(32))
    );
    global.gc?.();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(state.getVoluntaryExitValidity(signedExit(), true)).toBe("valid");
    expect(state.processSlots(state.slot + 1).getVoluntaryExitValidity(signedExit(), true)).toBe("valid");
  });

  it("keeps existing configurations usable when another constructor fails", () => {
    const {bytes, config} = createState();
    expect(() => new bindings.BeaconConfig({...stfConfig, BLOB_SCHEDULE: [{}]}, new Uint8Array(32))).toThrow(
      "NumberExpected"
    );
    const state = bindings.BeaconStateView.createFromBytes(bytes, config);
    expect(state.getVoluntaryExitValidity(signedExit(), true)).toBe("valid");
  });

  it("rejects a runtime preset that differs from the compiled preset", () => {
    expect(() => new bindings.BeaconConfig({...stfConfig, PRESET_BASE: "minimal"}, new Uint8Array(32))).toThrow(
      "PresetMismatch"
    );
  });

  it.each([0, 6001])("rejects unrepresentable slot duration %s", (duration) => {
    const config = {...stfConfig, SECONDS_PER_SLOT: 12, SLOT_DURATION_MS: duration};
    expect(() => new bindings.BeaconConfig(config, new Uint8Array(32))).toThrow("InvalidSlotDuration");
  });

  it("isolates worker configuration and metrics from the main environment", {timeout: 20_000}, async () => {
    const {state} = createState();
    bindings.metrics.init();
    bindings.metrics.registerLocalValidator(1);
    const metrics = bindings.metrics.scrapeMetrics();
    const expectedRoot = state.processSlots(state.slot + 33).hashTreeRoot();
    const beforeWorker = bindings.metrics.scrapeMetrics();
    expect(beforeWorker).toMatch(/validator_monitor_prev_epoch_on_chain_balance [1-9]\d*/);
    const root = await runWorker<Uint8Array>("isolated metrics");
    expect(root).toEqual(expectedRoot);
    expect(bindings.metrics.scrapeMetrics()).toBe(beforeWorker);
    expect(state.getVoluntaryExitValidity(signedExit(), true)).toBe("valid");
    expect(state.processSlots(state.slot + 33).hashTreeRoot()).toEqual(expectedRoot);
    expect(metrics).toContain("stfn_epoch_transition");
    bindings.metrics.unregisterLocalValidator(1);
  });

  it("runs simultaneous epoch transitions in independent workers", {timeout: 20_000}, async () => {
    const {state} = createState();
    const expectedRoot = state.processSlots(state.slot + 1).hashTreeRoot();
    const roots = await Promise.all(Array.from({length: 3}, () => runWorker<Uint8Array>("epoch transitions")));
    for (const [index, root] of roots.entries()) {
      expect(root, `worker ${index}`).toEqual(expectedRoot);
    }
  });

  it("allocates an independent bounded tree pool for each worker", async () => {
    const {state} = createState();
    const previousCapacity = process.env.LODESTAR_Z_NODE_POOL_CAPACITY;
    process.env.LODESTAR_Z_NODE_POOL_CAPACITY = "0";
    try {
      const code = await runWorker<string>("pool exhaustion");
      expect(code).toBe("PoolExhausted");
      expect(state.processSlots(state.slot + 1).slot).toBe(state.slot + 1);
    } finally {
      if (previousCapacity === undefined) {
        Reflect.deleteProperty(process.env, "LODESTAR_Z_NODE_POOL_CAPACITY");
      } else {
        process.env.LODESTAR_Z_NODE_POOL_CAPACITY = previousCapacity;
      }
    }
  });

  it("uses a distinct historical metrics prefix", async () => {
    const metrics = await runWorker<string>("historical metrics");
    expect(metrics).toContain("lodestar_historical_state_stfn_epoch_transition_seconds");
    expect(metrics).not.toContain("\nlodestar_stfn_");
  });

  it("rejects a changed metrics prefix after initialization", () => {
    bindings.metrics.init();
    expect(() => bindings.metrics.init({historical: true})).toThrow("MetricsAlreadyInitialized");
  });
});

function runWorker<T>(scenario: EnvironmentScenario): Promise<T> {
  return new Promise((resolve, reject) => {
    let result: T;
    const worker = new Worker(new URL("./fixtures/stateEnvironment.ts", import.meta.url), {
      execArgv: ["--import", "tsx"],
      workerData: scenario,
    });
    worker.on("message", (message: T) => {
      result = message;
    });
    worker.on("error", reject);
    worker.on("exit", (code) => (code === 0 ? resolve(result) : reject(new Error(`Worker exited with code ${code}`))));
  });
}
