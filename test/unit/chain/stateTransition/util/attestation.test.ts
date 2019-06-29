import BN from "bn.js";
import { assert } from "chai";

import {
  getBitfieldBit,
  verifyBitfield
} from "../../../../../src/chain/stateTransition/util";


describe("getBitfieldBit", () => {
  it("should return 1 for the 4th (index 3) bit of [0x8]", () => {
    const result = getBitfieldBit(Buffer.from([0x8]), 3);
    assert.equal(result, 1, `returned ${result} not 1`);
  });
  it("should return 0 for the 3rd (index 2) bit of [0x8]", () => {
    const result = getBitfieldBit(Buffer.from([0x8]), 2);
    assert.equal(result, 0, `returned ${result} not 0`);
  });
  it("should return 1 for the 18th (index 17) bit of [0x8, 0x4, 0x2, 0x1]", () => {
    const result = getBitfieldBit(Buffer.from([0x8, 0x4, 0x2, 0x1]), 17);
    assert.equal(result, 1, `returned ${result} not 1`);
  });
  it("should return 1 for the 19th (index 18) bit of [0x8, 0x4, 0x2, 0x1]", () => {
    const result = getBitfieldBit(Buffer.from([0x8, 0x4, 0x2, 0x1]), 18);
    assert.equal(result, 0, `returned ${result} not 0`);
  });
});

describe("verifyBitfield", () => {
  it("should detect incorrect byte-length bitfields", () => {
    const byteLength = 10; // min committeeSize == 73, max committeeSize == 80
    const bitfield = Buffer.alloc(byteLength);
    for (let committeeSize = (byteLength - 1) * 8; committeeSize < (byteLength + 1) * 8; committeeSize++) {
      if (
        committeeSize < (byteLength - 1) * 8 + 1 ||
        committeeSize > (byteLength * 8)
      ) {
        assert(!verifyBitfield(bitfield, committeeSize));
      } else {
        assert(verifyBitfield(bitfield, committeeSize));
      }
    }
  });
  it("should detect extraneous 1s padding a bitfield", () => {
    const byteLength = 10; // min committeeSize == 73, max committeeSize == 80
    const bitfield = Buffer.alloc(byteLength);
    const committeeSize = (byteLength - 1) * 8 + 1;
    for (let i = 1; i < 8; i++) {
      bitfield[bitfield.length - 1] = 1 << i;
      assert(!verifyBitfield(bitfield, committeeSize));
    }
    bitfield[bitfield.length - 1] = 1 << 8;
    assert(verifyBitfield(bitfield, committeeSize));
  });
});
