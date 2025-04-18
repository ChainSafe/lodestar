import fs from "node:fs";
import {getV4Crypto} from "@chainsafe/enr";
import {publicKeyToProtobuf} from "@libp2p/crypto/keys";
import {peerIdFromPrivateKey} from "@libp2p/peer-id";
import {ChainForkConfig} from "@lodestar/config";
import {fromHex} from "@lodestar/utils";
import tmp from "tmp";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {initPrivateKeyAndEnr} from "../../../src/cmds/beacon/initPeerIdAndEnr.js";
import {BeaconArgs} from "../../../src/cmds/beacon/options.js";
import {testLogger} from "../../utils.js";

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
    const peerId = peerIdFromPrivateKey(privateKey);
    expect(enr.peerId.toString()).toBe(peerId.toString());
    const nodeIdFromEnr = enr.nodeId;
    const nodeIdFromPubkey = getV4Crypto().nodeId(privateKey.publicKey.raw);
    expect(nodeIdFromPubkey).toEqual(nodeIdFromEnr);
    // const publicKey2 = publicKeyToProtobuf(privateKey.publicKey);
    // const nodeIdFromPublickey2 = getV4Crypto().nodeId(publicKey2);
    // expect(nodeIdFromPublickey2).toEqual(nodeIdFromEnr);
    expect(fromHex(nodeIdFromEnr).length).toEqual(32);
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
