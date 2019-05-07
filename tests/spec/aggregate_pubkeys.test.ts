import {join} from "path";
import {describeSpecTest} from "@chainsafe/eth2.0-spec-test-util";
import bls from "../../src";

describeSpecTest(
    join(__dirname, "./spec-tests/tests/bls/aggregate_pubkeys/aggregate_pubkeys.yaml"),
    bls.aggregatePubkeys,
    ({input}) => {
        const sigs = [];
        input.forEach((sig) => {
            sigs.push(Buffer.from(sig.replace('0x', ''), 'hex'))
        });
        return [
            sigs
        ];
    },
    ({output}) => output,
    (result) => `0x${result.toString('hex')}`,
    () => false,
);
