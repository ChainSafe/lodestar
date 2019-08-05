import {join} from "path";
import {describeSpecTest} from "@chainsafe/eth2.0-spec-test-util";
import bls from "../../src";
import {padLeft} from "../../src/helpers/utils";

describeSpecTest(
    join(__dirname, "./spec-tests/tests/bls/sign_msg/sign_msg.yaml"),
    bls.sign,
    ({input}) => {
        const domain = padLeft(Buffer.from(input.domain.replace('0x', ''), 'hex'), 8);
        return [
            Buffer.from(input.privkey.replace('0x', ''), 'hex'),
            Buffer.from(input.message.replace('0x', ''), 'hex'),
            domain
        ];
    },
    ({output}) => output,
    (result) => `0x${result.toString('hex')}`,
    () => false,
);
