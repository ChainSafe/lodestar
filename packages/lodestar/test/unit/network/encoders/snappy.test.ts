import {SnappyEncoder} from "../../../../src/network/encoders";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {expect} from "chai";

describe("snappy encoder", function () {
    it("should do roundtrip", function () {
        const encoder = new SnappyEncoder();
        const data = Buffer.alloc(32, 19);
        const result = encoder.decode(config.types.Uint64, encoder.encode(config.types.Uint64, data));
        expect(result).to.be.deep.equal(data);
    });
});