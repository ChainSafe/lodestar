import {describeDirectorySpecTest, InputType} from "@chainsafe/eth2.0-spec-test-util/lib/single";
import {Attestation, Hash} from "@chainsafe/eth2.0-types";
import {join} from "path";
import {config} from "@chainsafe/eth2.0-config/lib/presets/minimal";
import {expect} from "chai";
import {IBaseSSZStaticTestCase} from "../../type";
import {hashTreeRoot, serialize, signingRoot} from "../../../../src";

interface IResult {
  root: Hash;
  signing: Hash;
  serialized: Buffer;
}

["ssz_lengthy", "ssz_max", "ssz_nil", "ssz_one", "ssz_random", "ssz_random_chaos", "ssz_zero"].forEach((caseName) => {

  describeDirectorySpecTest<IBaseSSZStaticTestCase<Attestation>, IResult>(
    `attestation ${caseName} minimal`,
    join(__dirname, `../../../../../spec-test-cases/tests/minimal/phase0/ssz_static/Attestation/${caseName}`),
    (testcase) => {
      const serialized = serialize(testcase.serialized, config.types.Attestation);
      const root = hashTreeRoot(testcase.serialized, config.types.Attestation);
      const signing = signingRoot(testcase.serialized, config.types.Attestation);
      return {
        serialized,
        root,
        signing
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
        serialized: config.types.Attestation,
      },
      getExpected: (testCase => {
        return {
          root: Buffer.from(testCase.roots.root.replace("0x", ""), "hex"),
          signing: Buffer.from(testCase.roots.signingRoot.replace("0x", ""), "hex"),
          // @ts-ignore
          serialized: testCase.serialized_raw
        };
      }),
      expectFunc: (testCase, expected, actual) => {
        expect(expected.serialized.equals(actual.serialized)).to.be.true;
        expect(expected.root.equals(actual.root)).to.be.true;
        expect(expected.signing.equals(actual.signing)).to.be.true;
      },
      unsafeInput: true,
    }
  );

});
