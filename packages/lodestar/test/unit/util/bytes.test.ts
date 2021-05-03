import {expect} from "chai";
import {fromHexString, toHexString} from "@chainsafe/ssz";

import {byteArrayConcat, byteArrayEquals} from "../../../src/util/bytes";

describe("util / bytes", () => {
  describe("byteArrayConcat", () => {
    const testCases: {hexArr: string[]; res: string}[] = [
      {hexArr: [], res: "0x"},
      {hexArr: ["0x00"], res: "0x00"},
      {hexArr: ["0x01", "0x01", "0x01"], res: "0x010101"},
      {hexArr: ["0x0000", "0xaaaaaaaa", "0x1111"], res: "0x0000aaaaaaaa1111"},
    ];

    for (const {hexArr, res} of testCases) {
      it(`${res}`, () => {
        expect(toHexString(byteArrayConcat(hexArr.map(fromHexString)))).to.equal(res);
      });
    }
  });

  describe("byteArrayEquals", () => {
    const testCases: {hex1: string; hex2: string; isEqual: boolean}[] = [
      {hex1: "0x00", hex2: "0x00", isEqual: true},
      {hex1: "0x00", hex2: "0x01", isEqual: false},
      {hex1: "0x00", hex2: "0x0000", isEqual: false},
      {hex1: "0x01010101", hex2: "0x01010101", isEqual: true},
    ];

    for (const {hex1, hex2, isEqual} of testCases) {
      it(`${hex1} == ${hex2} -> ${isEqual}`, () => {
        expect(byteArrayEquals(fromHexString(hex1), fromHexString(hex2))).to.equal(isEqual);
      });
    }
  });
});
