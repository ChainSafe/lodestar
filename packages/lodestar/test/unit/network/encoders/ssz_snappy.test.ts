import {SnappyEncoder, SszEncoder} from "../../../../src/network/encoders";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {Uint64} from "@chainsafe/lodestar-types";
import { expect } from "chai";

describe("ssz_snappy encoder", function () {
    it("should do roundtrip", function () {
        const sszEncoder = new SszEncoder();
        const snappyEncoder = new SnappyEncoder();
        const encoders = [sszEncoder, snappyEncoder];
        const data = BigInt(32);
        const encoded = encoders.reduce((result: unknown, encoder) => {
            return encoder.encode(config.types.Uint64, result as any);
        }, data) as Buffer;
        const result = encoders.reverse().reduce((result: unknown, encoder) => {
            return encoder.decode(config.types.Uint64, result as any);
        }, encoded) as unknown as Uint64;
        expect(result).to.be.equal(data);
    });
});