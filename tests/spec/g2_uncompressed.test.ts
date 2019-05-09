import {join} from "path";
import {describeSpecTest} from "@chainsafe/eth2.0-spec-test-util";
import {padLeft} from "../../src/helpers/utils";
import {G2point} from "../../src/helpers/g2point";

describeSpecTest(
    join(__dirname, "./spec-tests/tests/bls/msg_hash_g2_uncompressed/g2_uncompressed.yaml"),
    G2point.hashToG2,
    ({input}) => {
        const domain = padLeft(Buffer.from(input.domain.replace('0x', ''), 'hex'), 8);
        return [
            Buffer.from(input.message.replace('0x', ''), 'hex'),
            domain
        ];
    },
    ({output}) => {
        return '0x' + G2point.fromUncompressedInput(
            Buffer.from(output[0][0].replace('0x', ''), 'hex'),
            Buffer.from(output[0][1].replace('0x', ''), 'hex'),
            Buffer.from(output[1][0].replace('0x', ''), 'hex'),
            Buffer.from(output[1][1].replace('0x', ''), 'hex'),
            Buffer.from(output[2][0].replace('0x', ''), 'hex'),
            Buffer.from(output[2][1].replace('0x', ''), 'hex'),
        ).toBytesCompressed().toString('hex');
    },
    (result:G2point) => `0x${result.toBytesCompressed().toString('hex')}`,
    () => false,
);
