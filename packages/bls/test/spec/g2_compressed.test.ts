import {join} from "path";
import {describeSpecTest} from "@chainsafe/eth2.0-spec-test-util";
import {padLeft} from "../../src/helpers/utils";
import {G2point} from "../../src/helpers/g2point";

describeSpecTest(
  join(__dirname, "../../../spec-test-cases/tests/bls/msg_hash_g2_compressed/g2_compressed.yaml"),
  G2point.hashToG2,
  ({input}) => {
    const domain = padLeft(Buffer.from(input.domain.replace('0x', ''), 'hex'), 8);
    return [
      Buffer.from(input.message.replace('0x', ''), 'hex'),
      domain
    ];
  },
  ({output}) => {
    const xReExpected = padLeft(Buffer.from(output[0].replace('0x', ''), 'hex'), 48);
    const xImExpected = padLeft(Buffer.from(output[1].replace('0x', ''), 'hex'), 48);
    return '0x' + Buffer.concat([xReExpected, xImExpected]).toString('hex');
  },
  (result: G2point) => `0x${result.toBytesCompressed().toString('hex')}`,
  () => false,
);
