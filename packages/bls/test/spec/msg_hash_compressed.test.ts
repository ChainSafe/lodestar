import path from "path";
import {describeDirectorySpecTest, InputType} from "@chainsafe/eth2.0-spec-test-util/lib/single";
import {PrivateKey} from "../../src";
import {padLeft} from "../../src/helpers/utils";

interface IMsgHHashCOmpressed {
  data: {
    input: {
      message: string;
      domain: string;
    };
    output: string[];
  };
}

describeDirectorySpecTest<IMsgHHashCOmpressed, string>(
  "msg_hash_compressed",
  path.join(
    __dirname,
    "../../../../node_modules/@chainsafe/eth2-spec-tests/tests/general/phase0/bls/msg_hash_compressed/small"
  ),
  (testCase => {
    const domain = Buffer.from(testCase.data.input.domain.replace("0x", ""), "hex");
    const input = Buffer.from(testCase.data.input.message.replace("0x", ""), "hex");
    const result  = PrivateKey.fromInt(1).signMessage(input, domain).toBytesCompressed().toString("hex");
    return `0x${result}`;
  }),
  {
    inputTypes: {
      data: InputType.YAML,
    },
    getExpected: (testCase => {
      const xReExpected = padLeft(Buffer.from(testCase.data.output[0].replace("0x", ""), "hex"), 48);
      const xImExpected = padLeft(Buffer.from(testCase.data.output[1].replace("0x", ""), "hex"), 48);
      return "0x" + Buffer.concat([xReExpected, xImExpected]).toString("hex");
    })
  }
);