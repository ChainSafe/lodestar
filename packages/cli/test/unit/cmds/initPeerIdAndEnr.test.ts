import fs from "node:fs";
import {generateKeyPair} from "@libp2p/crypto/keys";
import {peerIdFromPrivateKey} from "@libp2p/peer-id";
import {SignableENR} from "@chainsafe/enr";
import tmp from "tmp";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {initPrivateKeyAndEnr, overwriteEnrWithCliArgs} from "../../../src/cmds/beacon/initPeerIdAndEnr.js";
import {BeaconArgs} from "../../../src/cmds/beacon/options.js";
import {testLogger} from "../../utils.js";

describe("overwriteEnrWithCliArgs", () => {
  it("should set tcp and quic fields by default", async () => {
    const privateKey = await generateKeyPair("secp256k1");
    const enr = SignableENR.createFromPrivateKey(privateKey);
    const logger = testLogger();

    overwriteEnrWithCliArgs(
      enr,
      {listenAddress: "0.0.0.0", port: 9000, nat: true} as unknown as BeaconArgs,
      logger
    );

    expect(enr.tcp).toBe(9000);
    expect(enr.quic).toBe(9001);
  });

  it("should not set tcp fields when disableTcp is true", async () => {
    const privateKey = await generateKeyPair("secp256k1");
    const enr = SignableENR.createFromPrivateKey(privateKey);
    const logger = testLogger();

    overwriteEnrWithCliArgs(
      enr,
      {listenAddress: "0.0.0.0", port: 9000, disableTcp: true, nat: true} as unknown as BeaconArgs,
      logger
    );

    expect(enr.tcp).toBeUndefined();
    expect(enr.tcp6).toBeUndefined();
    expect(enr.quic).toBe(9001);
  });

  it("should not set quic fields when disableQuic is true", async () => {
    const privateKey = await generateKeyPair("secp256k1");
    const enr = SignableENR.createFromPrivateKey(privateKey);
    const logger = testLogger();

    overwriteEnrWithCliArgs(
      enr,
      {listenAddress: "0.0.0.0", port: 9000, disableQuic: true, nat: true} as unknown as BeaconArgs,
      logger
    );

    expect(enr.tcp).toBe(9000);
    expect(enr.quic).toBeUndefined();
    expect(enr.quic6).toBeUndefined();
  });

  it("should clear pre-existing tcp fields when disableTcp is true", async () => {
    const privateKey = await generateKeyPair("secp256k1");
    const enr = SignableENR.createFromPrivateKey(privateKey);
    enr.tcp = 9000;
    const logger = testLogger();

    overwriteEnrWithCliArgs(
      enr,
      {listenAddress: "0.0.0.0", port: 9000, disableTcp: true, nat: true} as unknown as BeaconArgs,
      logger
    );

    expect(enr.tcp).toBeUndefined();
  });
});

describe("initPeerIdAndEnr", () => {
  let tmpDir: tmp.DirResult;

  beforeEach(() => {
    tmpDir = tmp.dirSync();
  });

  afterEach(() => {
    fs.rmSync(tmpDir.name, {recursive: true});
  });

  it("first time should create a new enr and peer id", async () => {
    const {enr, privateKey} = await initPrivateKeyAndEnr(
      {persistNetworkIdentity: true} as unknown as BeaconArgs,
      tmpDir.name,
      testLogger(),
      true
    );
    // "enr peer id doesn't equal the returned peer id"
    expect(enr.peerId.toString()).toBe(peerIdFromPrivateKey(privateKey).toString());
    expect(enr.seq).toBe(BigInt(1));
    expect(enr.tcp).toBeUndefined();
    expect(enr.tcp6).toBeUndefined();
  });

  it("second time should use ths existing enr and peer id", async () => {
    const run1 = await initPrivateKeyAndEnr(
      {persistNetworkIdentity: true} as unknown as BeaconArgs,
      tmpDir.name,
      testLogger(),
      true
    );

    const run2 = await initPrivateKeyAndEnr(
      {persistNetworkIdentity: true} as unknown as BeaconArgs,
      tmpDir.name,
      testLogger(),
      true
    );

    expect(run1.privateKey.equals(run2.privateKey)).toBe(true);
    expect(run1.enr.encodeTxt()).toBe(run2.enr.encodeTxt());
  });
});
