import {SszEncoder} from "../../../../src/network/encoders";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {Uint64} from "@chainsafe/lodestar-types";
import { expect } from "chai";

describe("ssz encoder", function () {
    it("should do roundtrip", function () {
        const encoder = new SszEncoder();
        const data = BigInt(32);
        const result = encoder.decode(config.types.Uint64, encoder.encode<Uint64>(config.types.Uint64, data));
        expect(result).to.be.deep.equal(data);
    });
});