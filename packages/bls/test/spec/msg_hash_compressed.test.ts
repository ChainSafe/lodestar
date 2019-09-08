import path from "path";
import {padLeft} from "../../src/helpers/utils";
import {G2point} from "../../src/helpers/g2point";
import {describeDirectorySpecTest, InputType} from "@chainsafe/eth2.0-spec-test-util/lib/single";

interface MsgHHashCOmpressed {
  data: {
    input: {
      message: string;
      domain: string;
    };
    output: string[];
  };
}

describeDirectorySpecTest<MsgHHashCOmpressed, string>(
  "msg_hash_compressed",
  path.join(__dirname, "../../../spec-test-cases/tests/general/phase0/bls/msg_hash_compressed/small"),
  (testCase => {
    const domain = padLeft(Buffer.from(testCase.data.input.domain.replace('0x', ''), 'hex'), 8);
    const input = Buffer.from(testCase.data.input.message.replace('0x', ''), "hex");
    const result = G2point.hashToG2(input, domain);
    return `0x${result.toBytesCompressed().toString('hex')}`;
  }),
  {
    inputTypes: {
      data: InputType.YAML,
    },
    getExpected: (testCase => {
      const xReExpected = padLeft(Buffer.from(testCase.data.output[0].replace('0x', ''), 'hex'), 48);
      const xImExpected = padLeft(Buffer.from(testCase.data.output[1].replace('0x', ''), 'hex'), 48);
      return '0x' + Buffer.concat([xReExpected, xImExpected]).toString('hex');
    })
  }
);