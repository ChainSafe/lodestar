import {join} from "path";
import {describeSpecTest} from "@chainsafe/eth2.0-spec-test-util";
import bls from "../../src";
import {G2point} from "../../src/helpers/g2point";
import {BLSPubkey} from "../../src/types";

describeSpecTest(
    join(__dirname, "./spec-tests/tests/bls/aggregate_sigs/aggregate_sigs.yaml"),
    bls.aggregateSignatures,
    ({input}) => {
        const pubKeys: BLSPubkey[] = [];
        input.forEach((pubKey: string) => {
            pubKeys.push(Buffer.from(pubKey.replace('0x', ''), 'hex'))
        });
        return [
            pubKeys
        ];
    },
    ({output}) => output,
    (result) => `0x${result.toString('hex')}`,
    () => false,
);
