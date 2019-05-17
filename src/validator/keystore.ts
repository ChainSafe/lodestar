/**
 * @module validator
 */

import bls from "@chainsafe/bls-js";
import fs from "fs";

import {blsPrivateKeyToHex} from "../util/bytes";
import {encryptKey, decryptKey} from "../util/encrypt";

export default class Keystore {
  public encryptedPrivateKey: string;
  public publicKey: string;

  public constructor(password: string) {
    const keyPair = bls.generateKeyPair();

    this.encryptedPrivateKey = encryptKey(blsPrivateKeyToHex(keyPair.privateKey), password);
    this.publicKey = keyPair.publicKey.toHexString();
  }

  public privateKey(password: string): string {
    return decryptKey(this.encryptedPrivateKey, password);
  }

  public saveKeys(password: string, outputFilePath: string): void {
    try {
      fs.writeFileSync(outputFilePath, JSON.stringify(this, null, 2));
    } catch (err) {
      throw new Error(`Failed to write to ${outputFilePath}: ${err}`);
    }
  }
}
