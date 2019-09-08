import {join} from "path";
import {config} from "@chainsafe/eth2.0-config/lib/presets/minimal";
import {describeDirectorySpecTest, InputType} from "@chainsafe/eth2.0-spec-test-util/lib/single";
import {computeShuffledIndex} from "../../../src/chain/stateTransition/util";
import {ShufflingTestCase} from "./type";

describeDirectorySpecTest<ShufflingTestCase, number[]>(
  "shuffling minimal",
  join(__dirname, "../../../../spec-test-cases/tests/minimal/phase0/shuffling/core/shuffle"),
  (testcase) => {
    const output = [];
    const seed = Buffer.from(testcase.mapping.seed.replace("0x", ""),"hex");
    for(let i = 0; i < testcase.mapping.count.toNumber(); i++) {
      output[i] = computeShuffledIndex(
        config,
        i,
        testcase.mapping.count.toNumber(),
        seed
      );
    }
    return output;
  },
  {
    inputTypes: {
      mapping: InputType.YAML
    },
    getExpected: (testCase => testCase.mapping.mapping.map((value) => value.toNumber()))
  }
);
