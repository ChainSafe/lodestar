import assert from "assert";
import {BIG} from "@chainsafe/milagro-crypto-js/src/big";
import ctx from "../ctx";

/**
 * Pads byte array with zeroes on left side up to desired length.
 * Throws if source is larger than desired result.
 * @param source
 * @param length
 */
export function padLeft(source: Buffer, length: number): Buffer {
  assert(source.length <= length, 'Given array must be smaller or equal to desired array size');
  const result = Buffer.alloc(length, 0);
  source.copy(result, length - source.length);
  return result;
}

//TODO: find a way to convert ctx.ROM_FIELD.MODULUS to BIG (MODULUS basebit = 58, BIG basebit=23
export function getModulus(): BIG {
  return ctx.BIG.frombytearray(
    Buffer.from(
      '1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaab',
      'hex'
    ),
    0
  );
}

export function calculateYFlag(yIm: BIG): boolean {
  const tmp = new ctx.BIG(yIm);
  tmp.add(yIm);
  tmp.div(getModulus());
  return tmp.isunity();
}
