import fs from "node:fs";
import path from "node:path";
import {afterAll, beforeAll, describe, expect, it} from "vitest";
import {Keystore} from "@chainsafe/bls-keystore";
import {SecretKey} from "@chainsafe/lodestar-z/blst";
import {loadBuilderKeypair} from "../../../../src/cmds/builder/loadKeypair.js";
import {testFilesDir} from "../../../utils.js";

describe("Keystore loading", () => {
  const testFilesDirBuilder = path.join(testFilesDir, "builder");
  const keystorePath = path.join(testFilesDirBuilder, "keystore.json");
  const passwordPath = path.join(testFilesDirBuilder, "password.txt");
  const wrongPasswordPath = path.join(testFilesDirBuilder, "wrongPassword.txt");

  const password = "testpassword";
  const wrongPassword = "wrongPassword";
  const secretKeyBytes = Buffer.alloc(32, 1);
  const publicKey = SecretKey.fromBytes(secretKeyBytes).toPublicKey();

  beforeAll(async () => {
    fs.mkdirSync(testFilesDirBuilder, {recursive: true});
    const keystore = await Keystore.create(password, secretKeyBytes, publicKey.toBytes(), "");
    fs.writeFileSync(keystorePath, keystore.stringify());
    fs.writeFileSync(passwordPath, password);
    fs.writeFileSync(wrongPasswordPath, wrongPassword);
  });

  afterAll(() => {
    fs.rmSync(testFilesDirBuilder, {recursive: true});
  });

  it("Successful keystore load", async () => {
    const {secretKey} = await loadBuilderKeypair(keystorePath, passwordPath);
    expect(secretKey.toBytes()).toEqual(Uint8Array.from(secretKeyBytes));
  });

  it("Successful keystore load with matching pubkey", async () => {
    const {secretKey} = await loadBuilderKeypair(keystorePath, passwordPath, publicKey.toHex());
    expect(secretKey.toBytes()).toEqual(Uint8Array.from(secretKeyBytes));
  });

  it("Successful keystore load with matching uppercase pubkey", async () => {
    const {secretKey} = await loadBuilderKeypair(keystorePath, passwordPath, publicKey.toHex().toUpperCase());
    expect(secretKey.toBytes()).toEqual(Uint8Array.from(secretKeyBytes));
  });

  it("Shouldn't load with improper password", async () => {
    await expect(loadBuilderKeypair(keystorePath, wrongPasswordPath)).rejects.toThrow(
      `Invalid password for keystore ${keystorePath}`
    );
  });

  it("Shouldn't load on pubkey mismatch", async () => {
    const wrongSecretKey = SecretKey.fromBytes(Buffer.alloc(32, 2));
    const wrongPublicKey = wrongSecretKey.toPublicKey().toHex();

    await expect(loadBuilderKeypair(keystorePath, passwordPath, wrongPublicKey)).rejects.toThrow(
      `Pubkey mismatch: keystore ${publicKey.toHex()}, expected ${wrongPublicKey}`
    );
  });
});
