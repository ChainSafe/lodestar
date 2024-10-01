import {itBench} from "@dapplion/benchmark";
import {unshuffleList} from "@chainsafe/swap-or-not-shuffle";
import {ssz} from "@lodestar/types";
import {SHUFFLE_ROUND_COUNT} from "@lodestar/params";
import {generatePerfTestCachedStatePhase0, numValidators} from "./util.js";

// Test cost of hashing state after some modifications

describe("BeaconState hashTreeRoot", () => {
  const vc = numValidators;
  let indicesShuffled: Uint32Array;
  let stateOg: ReturnType<typeof generatePerfTestCachedStatePhase0>;

  before(function () {
    this.timeout(300_000);
    stateOg = generatePerfTestCachedStatePhase0();
    stateOg.hashTreeRoot();

    const seed = new Uint8Array(32);
    seed.set([42, 32], 0);
    const preShuffle = new Uint32Array(numValidators);
    for (let i = 0; i < vc; i++) {
      preShuffle[i] = i;
    }
    indicesShuffled = unshuffleList(preShuffle, seed, SHUFFLE_ROUND_COUNT);
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
