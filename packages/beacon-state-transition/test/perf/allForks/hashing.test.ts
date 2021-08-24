import {itBench, setBenchOpts} from "@dapplion/benchmark";
import {phase0, ssz} from "@chainsafe/lodestar-types";
import {TreeBacked} from "@chainsafe/ssz";
import {generatePerformanceStatePhase0, getPubkeys, numValidators} from "../util";
import {unshuffleList} from "../../../src";

// Test cost of hashing state after some modifications

describe("state hashTreeRoot", () => {
  setBenchOpts({maxMs: 60 * 1000});

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
  const balance = BigInt(31e9);

  const testCases: {id: string; track?: boolean; fn: (state: TreeBacked<phase0.BeaconState>) => void}[] = [
    {
      id: "No change",
      fn: () => {
        //
      },
    },
  ];

  // Validator mutations
  for (const count of [1, 32, 512]) {
    const idxs = indicesShuffled.slice(0, count);
    testCases.push({
      id: `${count} full validator`,
      track: count >= 512,
      fn: (state) => {
        for (const i of idxs) state.validators[i] = validator;
      },
    });
  }

  for (const count of [1, 32, 512]) {
    const idxs = indicesShuffled.slice(0, count);
    testCases.push({
      id: `${count} validator.effectiveBalance`,
      track: count >= 512,
      fn: (state) => {
        for (const i of idxs) state.validators[i].effectiveBalance = balance;
      },
    });
  }

  // Balance mutations
  for (const count of [1, 32, 512, numValidators]) {
    const idxs = indicesShuffled.slice(0, count);
    testCases.push({
      id: `${count} balances`,
      track: count >= 512,
      fn: (state) => {
        for (const i of idxs) state.balances[i] = balance;
      },
    });
  }

  for (const {id, track, fn} of testCases) {
    itBench<TreeBacked<phase0.BeaconState>, TreeBacked<phase0.BeaconState>>({
      id: `state hashTreeRoot - ${id}`,
      threshold: !track ? Infinity : undefined,
      beforeEach: () => {
        fn(stateOg);
        return stateOg;
      },
      fn: (state) => {
        state.hashTreeRoot();
      },
    });
  }
});
