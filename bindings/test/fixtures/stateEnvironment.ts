import assert from "node:assert/strict";
import {parentPort, workerData} from "node:worker_threads";
import {ssz} from "@lodestar/types";
import bindings from "../../src/index.js";
import {createStfState, stfConfig} from "../stfFixture.js";

const scenarios = {
  "epoch transitions": () => {
    const config = new bindings.BeaconConfig(stfConfig, new Uint8Array(32));
    const state = bindings.BeaconStateView.createFromBytes(ssz.fulu.BeaconState.serialize(createStfState()), config);
    let root: Uint8Array | undefined;
    for (let i = 0; i < 8; i++) root = state.processSlots(state.slot + 1).hashTreeRoot();
    return root;
  },
  "historical metrics": () => {
    bindings.metrics.init({historical: true});
    bindings.metrics.init({historical: true});
    return bindings.metrics.scrapeMetrics();
  },
  "isolated metrics": () => {
    const config = new bindings.BeaconConfig(stfConfig, new Uint8Array(32));
    bindings.metrics.init();
    bindings.metrics.registerLocalValidator(2);
    bindings.metrics.registerLocalValidator(3);
    const state = bindings.BeaconStateView.createFromBytes(ssz.fulu.BeaconState.serialize(createStfState()), config);
    return state.processSlots(state.slot + 33).hashTreeRoot();
  },
  "pool exhaustion": () => {
    const config = new bindings.BeaconConfig(stfConfig, new Uint8Array(32));
    try {
      bindings.BeaconStateView.createFromBytes(ssz.fulu.BeaconState.serialize(createStfState()), config);
      return "created";
    } catch (error) {
      assert(error instanceof Error && "code" in error);
      return error.code;
    }
  },
};

export type EnvironmentScenario = keyof typeof scenarios;

const scenario: unknown = workerData;
assert(typeof scenario === "string" && Object.hasOwn(scenarios, scenario), `Unknown environment scenario: ${scenario}`);
assert(parentPort);
parentPort.postMessage(scenarios[scenario as EnvironmentScenario]());
