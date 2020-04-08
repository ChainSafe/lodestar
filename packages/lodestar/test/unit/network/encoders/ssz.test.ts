import {SszEncoder} from "../../../../src/network/encoders";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {Status, Uint64} from "@chainsafe/lodestar-types";
import {expect} from "chai";

describe("ssz encoder", function () {
  it("should do roundtrip basic", function () {
    const encoder = new SszEncoder();
    const data = BigInt(32);
    const result = encoder.decode(config.types.Uint64, encoder.encode<Uint64>(config.types.Uint64, data));
    expect(result).to.be.deep.equal(data);
  });
  it("should do roundtrip container", function () {
    const encoder = new SszEncoder<any>();
    const data: Status = {
      finalizedEpoch: 3,
      finalizedRoot: Buffer.alloc(32),
      forkDigest: Buffer.alloc(4),
      headRoot: Buffer.alloc(32),
      headSlot: 13
    };
    const result = encoder.decode(config.types.Status, encoder.encode<Status>(config.types.Status, data)) as Status;
    expect(config.types.Status.equals(result, data)).to.be.true;
  });
});