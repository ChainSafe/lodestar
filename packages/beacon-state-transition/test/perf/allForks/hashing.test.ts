import {itBench} from "@dapplion/benchmark";
import {phase0, ssz} from "@chainsafe/lodestar-types";
import {TreeBacked} from "@chainsafe/ssz";
import {generatePerformanceStatePhase0, getPubkeys, numValidators} from "../util";
import {unshuffleList} from "../../../src";

// Test cost of hashing state after some modifications

describe("BeaconState hashTreeRoot", () => {
  const vc = numValidators;
  const indicesShuffled: number[] = [];
  let stateOg: TreeBacked<phase0.BeaconState>;

  before(function () {
    this.timeout(300_000);
    const {pubkeys} = getPubkeys();
    stateOg = generatePerformanceStatePhase0(pubkeys);
    stateOg.hashTreeRoot();

    for (let i = 0; i < vc; i++) indicesShuffled[i] = i;
    unshuffleList(indicesShuffled, new Uint8Array([42, 32]));
  });

  const validator: phase0.Validator = ssz.phase0.Validator.defaultValue();
  const balance = 31e9;

  const testCases: {id: string; noTrack?: boolean; fn: (state: TreeBacked<phase0.BeaconState>) => void}[] = [
    {
      id: "No change",
      fn: () => {
        //
      },
    },
  ];

  // Validator mutations
  for (const count of [1, 32, 512]) {
    testCases.push({
      id: `${count} full validator`,
      noTrack: count < 512,
      fn: (state) => {
        for (const i of indicesShuffled.slice(0, count)) state.validators[i] = validator;
      },
    });
  }

  for (const count of [1, 32, 512]) {
    testCases.push({
      id: `${count} validator.effectiveBalance`,
      noTrack: count < 512,
      fn: (state) => {
        for (const i of indicesShuffled.slice(0, count)) {
          state.validators[i].effectiveBalance = balance;
        }
      },
    });
  }

  // Balance mutations
  for (const count of [1, 32, 512, numValidators]) {
    testCases.push({
      id: `${count} balances`,
      noTrack: count < 512,
      fn: (state) => {
        for (const i of indicesShuffled.slice(0, count)) state.balances[i] = balance;
      },
    });
  }

  for (const {id, noTrack, fn} of testCases) {
    itBench<TreeBacked<phase0.BeaconState>, TreeBacked<phase0.BeaconState>>({
      id: `BeaconState.hashTreeRoot - ${id}`,
      noThreshold: noTrack,
      beforeEach: () => {
        const state = stateOg.clone();
        fn(state);
        return state;
      },
      fn: (state) => {
        state.hashTreeRoot();
      },
    });
  }
});
