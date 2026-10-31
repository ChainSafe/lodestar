import assert from "node:assert/strict";
import {ssz} from "@lodestar/types";
import bindings from "../../src/index.js";
import {pubkeyCache} from "../../src/pubkeys.js";
import {createStfState, stfConfig} from "../stfFixture.js";

const config = new bindings.BeaconConfig(
  {...stfConfig, GLOAS_FORK_EPOCH: stfConfig.FULU_FORK_EPOCH + 1},
  new Uint8Array(32)
);
pubkeyCache.ensureCapacity(16);
const state = bindings.BeaconStateView.createFromBytes(ssz.fulu.BeaconState.serialize(createStfState()), config);

const operations = {
  "NaN validator index": () => state.getValidator(NaN),
  "fractional committee epoch": () => state.getBeaconCommitteeCountPerSlot(0.5),
  "fractional slot": () => state.processSlots(1.5),
  "infinite validator index": () => state.getValidator(Infinity),
  "invalid config Object.create(bindings.BeaconConfig.prototype)": () =>
    Reflect.apply(bindings.BeaconStateView.createFromBytes, bindings.BeaconStateView, [
      new Uint8Array(47),
      Object.create(bindings.BeaconConfig.prototype),
    ]),
  "invalid config null": () =>
    Reflect.apply(bindings.BeaconStateView.createFromBytes, bindings.BeaconStateView, [new Uint8Array(47), null]),
  "invalid config state": () =>
    Reflect.apply(bindings.BeaconStateView.createFromBytes, bindings.BeaconStateView, [new Uint8Array(47), state]),
  "invalid config undefined": () =>
    Reflect.apply(bindings.BeaconStateView.createFromBytes, bindings.BeaconStateView, [new Uint8Array(47), undefined]),
  "invalid config {}": () =>
    Reflect.apply(bindings.BeaconStateView.createFromBytes, bindings.BeaconStateView, [new Uint8Array(47), {}]),
  "invalid signed block offset": () => state.stateTransition(new Uint8Array(108).fill(255), false),
  "missing config": () =>
    Reflect.apply(bindings.BeaconStateView.createFromBytes, bindings.BeaconStateView, [new Uint8Array(47)]),
  "negative block-root slot": () => state.getBlockRootAtSlot(-1),
  "negative slot": () => state.processSlots(-1),
  "negative validator index": () => state.getValidator(-1),
  "noncanonical signed block offset": () => state.stateTransition(new Uint8Array(108), false),
  "truncated block": () => state.stateTransition(new Uint8Array(107), false),
  "truncated loaded state": () => state.loadOtherState(new Uint8Array(47)),
  "truncated state": () => bindings.BeaconStateView.createFromBytes(new Uint8Array(47), config),
  "unsafe validator index": () => state.getValidator(Number.MAX_SAFE_INTEGER + 1),
  "zero proof index": () => state.getSingleProof(0n),
};

export type BoundaryScenario = keyof typeof operations;

const scenario = process.argv[2];
const error = process.argv[3];
assert(scenario && Object.hasOwn(operations, scenario), `Unknown boundary scenario: ${scenario}`);
assert(error);
assert.throws(operations[scenario as BoundaryScenario], {message: error});
