import BN from "bn.js";
import { assert } from "chai";
import bls from '@chainsafe/bls';

import { intToBytes, blsPrivateKeyToHex } from "../../../src/util/bytes";
import { PrivateKey } from "@chainsafe/bls/lib/privateKey";

describe("intToBytes", () => {                                    
  const zeroedArray = (length) => Array.from({ length }, () => 0);                              
  const testCases: { input: [BN | number, number]; output: Buffer }[] = [
    { input: [255, 1], output: Buffer.from([255]) },                                        
    { input: [new BN(255), 1], output: Buffer.from([255]) },                                        
    { input: [65535, 2], output: Buffer.from([255, 255]) },
    { input: [new BN(65535), 2], output: Buffer.from([255, 255]) },
    { input: [16777215, 3], output: Buffer.from([255, 255, 255]) },
    { input: [new BN(16777215), 3], output: Buffer.from([255, 255, 255]) },
    { input: [4294967295, 4], output: Buffer.from([255, 255, 255, 255]) },
    { input: [new BN(4294967295), 4], output: Buffer.from([255, 255, 255, 255]) },
    { input: [65535, 8], output: Buffer.from([255, 255, ...zeroedArray(8-2)]) },
    { input: [new BN(65535), 8], output: Buffer.from([255, 255, ...zeroedArray(8-2)]) },
    { input: [65535, 32], output: Buffer.from([255, 255, ...zeroedArray(32-2)]) },
    { input: [new BN(65535), 32], output: Buffer.from([255, 255, ...zeroedArray(32-2)]) },
    { input: [65535, 48], output: Buffer.from([255, 255, ...zeroedArray(48-2)]) },
    { input: [new BN(65535), 48], output: Buffer.from([255, 255, ...zeroedArray(48-2)]) },
    { input: [65535, 96], output: Buffer.from([255, 255, ...zeroedArray(96-2)]) },
    { input: [new BN(65535), 96], output: Buffer.from([255, 255, ...zeroedArray(96-2)]) },
  ];
  for (const { input, output } of testCases) {
    const type = BN.isBN(input[0]) ? 'BN' : 'number';
    const length = input[1];
    it(`should correctly serialize ${type} to bytes length ${length}`, () => {
      assert(intToBytes(input[0], input[1]).equals(output));
    });
  }
});

describe("BLSPrivateKeyToHex conversion", () => {
  it(" generated private key should equal original", () => {
    const keyPair = bls.generateKeyPair();
    const hexString = blsPrivateKeyToHex(keyPair.privateKey);
    const remadeKey = PrivateKey.fromHexString(hexString);
    assert(hexString === blsPrivateKeyToHex(remadeKey));
  });
});
