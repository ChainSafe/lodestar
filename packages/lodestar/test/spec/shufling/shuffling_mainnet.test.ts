import {join} from "path";
import {describeSpecTest} from "@chainsafe/eth2.0-spec-test-util";
import {expect} from "chai";

import {config} from "../../../src/config/presets/mainnet";
import {computeShuffledIndex} from "../../../src/chain/stateTransition/util";
import {bytes32} from "../../../src/types";

describeSpecTest(
  join(__dirname, "../test-cases/tests/shuffling/core/shuffling_full.yaml"),
  (seed: bytes32, count: number) => {
    const output = [];
    for(let i = 0; i < count; i++) {
      output[i] = computeShuffledIndex(
        config,
        i,
        count,
        seed
      );
    }
    return output;
  },
  (input) => {
    return [Buffer.from(input.seed.slice(2), 'hex'), input.count.toNumber()];
  },
  (expected) => {
    return expected.shuffled.map((value) => value.toNumber());
  },
  result => result,
  (_) => {
    return false;
  },
  () => false,
  (_1, _2, expected, actual) => {
    expect(expected).to.be.deep.equal(actual);
  },
  0
);

