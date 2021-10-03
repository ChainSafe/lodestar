import {expect} from "chai";
import {
  QUANTITY,
  quantityToBytes,
  quantityToNum,
  quantityToBigint,
  numToQuantity,
  bytesToQuantity,
} from "../../../src/eth1/provider/utils";

describe("eth1 / hex encoding", () => {
  describe("QUANTITY", () => {
    const testCases: {
      quantity: QUANTITY;
      /** SSZ representation in little endian */
      bytes: string;
      num?: number;
      bigint: bigint;
    }[] = [
      {
        quantity: "0x7",
        bytes: "0700000000000000000000000000000000000000000000000000000000000000",
        num: 0x7,
        bigint: BigInt(0x7),
      },
      {
        quantity: "0xff",
        bytes: "ff00000000000000000000000000000000000000000000000000000000000000",
        num: 0xff,
        bigint: BigInt(0xff),
      },
      {
        quantity: "0xff00",
        bytes: "00ff000000000000000000000000000000000000000000000000000000000000",
        num: 0xff00,
        bigint: BigInt(0xff00),
      },
      // GENESIS_BASE_FEE_PER_GAS
      {
        quantity: "0x3b9aca00",
        bytes: "00ca9a3b00000000000000000000000000000000000000000000000000000000",
        num: 1000000000,
        bigint: BigInt(1000000000),
      },
      {
        quantity: "0xaabb",
        bytes: "bbaa000000000000000000000000000000000000000000000000000000000000",
        bigint: BigInt(0xaabb),
      },
      {
        quantity: "0xffffffffffffffffffffffffffffffff",
        bytes: "ffffffffffffffffffffffffffffffff00000000000000000000000000000000",
        bigint: BigInt("0xffffffffffffffffffffffffffffffff"),
      },
      {
        quantity: "0xffffffffffffffffffffffffffffffff00000000000000000000000000000000",
        bytes: "00000000000000000000000000000000ffffffffffffffffffffffffffffffff",
        bigint: BigInt("0xffffffffffffffffffffffffffffffff00000000000000000000000000000000"),
      },
    ];

    for (const {quantity, bytes, num, bigint} of testCases) {
      it(`quantityToBytes - ${quantity}`, () => {
        expect(Buffer.from(quantityToBytes(quantity)).toString("hex")).to.equal(bytes);
      });
      it(`quantityToBigint - ${quantity}`, () => {
        expect(quantityToBigint(quantity)).to.equal(bigint);
      });
      it(`bytesToQuantity - ${bytes}`, () => {
        expect(bytesToQuantity(Buffer.from(bytes, "hex"))).to.equal(quantity);
      });
      if (num !== undefined) {
        it(`quantityToNum - ${quantity}`, () => {
          expect(quantityToNum(quantity)).to.equal(num);
        });
        it(`numToQuantity - ${num}`, () => {
          expect(numToQuantity(num)).to.equal(quantity);
        });
      }
    }
  });
});
