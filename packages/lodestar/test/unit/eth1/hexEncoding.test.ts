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
    const testCases: {quantity: QUANTITY; bytes: string; num?: number; bigint: bigint}[] = [
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
        quantity: "0xffffffffffffffffffffffffffffffff00000000000000000000000000000000",
        bytes: "ffffffffffffffffffffffffffffffff00000000000000000000000000000000",
        bigint: BigInt(0xffffffffffffffffffffffffffffffff00000000000000000000000000000000),
      },
      {
        quantity: "0x00000000000000000000000000000000ffffffffffffffffffffffffffffffff",
        bytes: "00000000000000000000000000000000ffffffffffffffffffffffffffffffff",
        bigint: BigInt(0x00000000000000000000000000000000ffffffffffffffffffffffffffffffff),
      },
    ];

    for (const {quantity, bytes, num, bigint} of testCases) {
      it(`${quantity} -> bytes`, () => {
        expect(Buffer.from(quantityToBytes(quantity)).toString("hex")).to.equal(bytes);
      });
      it(`${quantity} -> bigint`, () => {
        expect(quantityToBigint(quantity)).to.equal(bigint);
      });
      it(`${bytes} -> QUANTITY`, () => {
        expect(bytesToQuantity(Buffer.from(bytes, "hex"))).to.equal(quantity);
      });
      if (num !== undefined) {
        it(`${quantity} -> num`, () => {
          expect(quantityToNum(quantity)).to.equal(num);
        });
        it(`${num} -> QUANTITY`, () => {
          expect(numToQuantity(num)).to.equal(quantity);
        });
      }
    }
  });
});
