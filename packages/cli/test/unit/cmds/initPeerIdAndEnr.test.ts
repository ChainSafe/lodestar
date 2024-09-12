import fs from "node:fs";
import {describe, it, expect, beforeEach, afterEach} from "vitest";
import tmp from "tmp";
import {peerIdFromPrivateKey} from "@libp2p/peer-id";
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
