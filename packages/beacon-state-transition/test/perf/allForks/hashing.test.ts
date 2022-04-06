import {itBench} from "@dapplion/benchmark";
import {ssz} from "@chainsafe/lodestar-types";
import {generatePerfTestCachedStatePhase0, numValidators} from "../util";
import {unshuffleList} from "../../../src/index.js";

// Test cost of hashing state after some modifications

describe("BeaconState hashTreeRoot", () => {
  const vc = numValidators;
  const indicesShuffled: number[] = [];
  let stateOg: ReturnType<typeof generatePerfTestCachedStatePhase0>;

  before(function () {
    this.timeout(300_000);
    stateOg = generatePerfTestCachedStatePhase0();
    stateOg.hashTreeRoot();

    for (let i = 0; i < vc; i++) indicesShuffled[i] = i;
    unshuffleList(indicesShuffled, new Uint8Array([42, 32]));
  });

  const validator = ssz.phase0.Validator.defaultViewDU();
  const balance = 31e9;

  const testCases: {id: string; noTrack?: boolean; fn: (state: typeof stateOg) => void}[] = [
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
        for (const i of indicesShuffled.slice(0, count)) state.validators.set(i, validator);
      },
    });
  }

  for (const count of [1, 32, 512]) {
    testCases.push({
      id: `${count} validator.effectiveBalance`,
      noTrack: count < 512,
      fn: (state) => {
        for (const i of indicesShuffled.slice(0, count)) {
          state.validators.get(i).effectiveBalance = balance;
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
        for (const i of indicesShuffled.slice(0, count)) state.balances.set(i, balance);
      },
    });
  }

  for (const {id, noTrack, fn} of testCases) {
    itBench<typeof stateOg, typeof stateOg>({
      id: `BeaconState.hashTreeRoot - ${id}`,
      noThreshold: noTrack,
      beforeEach: () => {
        const state = stateOg.clone();
        fn(state);
        state.commit();
        return state;
      },
      fn: (state) => {
        state.hashTreeRoot();
      },
    });
  }
});
