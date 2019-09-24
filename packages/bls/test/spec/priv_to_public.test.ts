import bls from "../../src";
import {describeDirectorySpecTest, InputType} from "@chainsafe/eth2.0-spec-test-util/lib/single";
import path from "path";

interface PrivToPubTestCase {
    data: {
        input: string;
        output: string;
    };
}

describeDirectorySpecTest<PrivToPubTestCase, string>(
    "priv_to_pub",
    path.join(__dirname, "../../../spec-test-cases/tests/general/phase0/bls/priv_to_pub/small"),
    (testCase => {
        const result =  bls.generatePublicKey(Buffer.from(testCase.data.input.replace('0x', ''), 'hex'));
        return `0x${result.toString('hex')}`;
    }),
    {
        inputTypes: {
            data: InputType.YAML,
        },
        getExpected: (testCase => testCase.data.output)
    }
);
