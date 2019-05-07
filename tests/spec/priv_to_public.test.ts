import {join} from "path";
import {describeSpecTest} from "@chainsafe/eth2.0-spec-test-util";
import bls from "../../src";

describeSpecTest(
    join(__dirname, "./spec-tests/tests/bls/priv_to_pub/priv_to_pub.yaml"),
    bls.generatePublicKey,
    ({input}) => {
        return [Buffer.from(input.replace('0x', ''), 'hex')];
    },
    ({output}) => output,
    (result) => `0x${result.toString('hex')}`,
    () => false,
);
