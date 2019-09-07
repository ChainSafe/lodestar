import {describeDirectorySpecTest, InputType} from "@chainsafe/eth2.0-spec-test-util/lib/single";
import {BeaconBlockBody, Hash} from "@chainsafe/eth2.0-types";
import {join} from "path";
import {config} from "@chainsafe/eth2.0-config/lib/presets/minimal";
import {expect} from "chai";
import {BaseSSZStaticTestCase} from "../../type";
import {hashTreeRoot, serialize} from "../../../../src";

interface Result {
  root: Hash;
  serialized: Buffer;
}

["ssz_lengthy", "ssz_max", "ssz_nil", "ssz_one", "ssz_random", "ssz_random_chaos", "ssz_zero"].forEach((caseName) => {

  describeDirectorySpecTest<BaseSSZStaticTestCase<BeaconBlockBody>, Result>(
    `beacon block body ${caseName} minimal`,
    join(__dirname, `../../../../../spec-test-cases/tests/minimal/phase0/ssz_static/BeaconBlockBody/${caseName}`),
    (testcase) => {
      const serialized = serialize(testcase.serialized, config.types.BeaconBlockBody);
      const root = hashTreeRoot(testcase.serialized, config.types.BeaconBlockBody);
      return {
        serialized,
        root
      };
    },
    {
      // @ts-ignore
      inputTypes: {
        roots: InputType.YAML,
        serialized: InputType.SSZ
      },
      // @ts-ignore
      sszTypes: {
        serialized: config.types.BeaconBlockBody,
      },
      getExpected: (testCase => {
        return {
          root: Buffer.from(testCase.roots.root.replace("0x", ""), "hex"),
          // @ts-ignore
          serialized: testCase.serialized_raw
        };
      }),
      expectFunc: (testCase, expected, actual) => {
        expect(expected.serialized.equals(actual.serialized)).to.be.true;
        expect(expected.root.equals(actual.root)).to.be.true;
      }
    }
  );

});
