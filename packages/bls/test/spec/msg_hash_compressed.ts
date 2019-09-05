import path from "path";
import {padLeft} from "../../src/helpers/utils";
import {G2point} from "../../src/helpers/g2point";
import {describeDirectorySpecTest, InputType} from "@chainsafe/eth2.0-spec-test-util/lib/single";

interface MsgHHashUnCompressed {
    data: {
        input: {
            message: string,
            domain: string
        };
        output: string[][];
    };
}

describeDirectorySpecTest<MsgHHashUnCompressed, string>(
    "msg_hash_uncompressed",
    path.join(__dirname, "../../../spec-test-cases/tests/general/phase0/bls/msg_hash_uncompressed/small"),
    (testCase => {
        const domain = padLeft(Buffer.from(testCase.data.input.domain.replace('0x', ''), 'hex'), 8);
        const input = Buffer.from(testCase.data.input.message, "hex");
        const result = G2point.hashToG2(input, domain);
        return `0x${result.toBytesCompressed().toString('hex')}`
    }),
    {
        inputTypes: {
            data: InputType.YAML,
        },
        getExpected: (testCase => {
            return '0x' + G2point.fromUncompressedInput(
                Buffer.from(testCase.data.output[0][0].replace('0x', ''), 'hex'),
                Buffer.from(testCase.data.output[0][1].replace('0x', ''), 'hex'),
                Buffer.from(testCase.data.output[1][0].replace('0x', ''), 'hex'),
                Buffer.from(testCase.data.output[1][1].replace('0x', ''), 'hex'),
                Buffer.from(testCase.data.output[2][0].replace('0x', ''), 'hex'),
                Buffer.from(testCase.data.output[2][1].replace('0x', ''), 'hex'),
            ).toBytesCompressed().toString('hex');
        })
    }
);