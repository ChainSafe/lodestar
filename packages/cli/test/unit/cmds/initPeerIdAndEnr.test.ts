import fs from "node:fs";
import tmp from "tmp";
import {expect} from "chai";
import {initPeerIdAndEnr} from "../../../src/cmds/beacon/initPeerIdAndEnr.js";
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
    const {enr, peerId} = await initPeerIdAndEnr(
      {persistNetworkIdentity: true} as unknown as BeaconArgs,
      tmpDir.name,
      testLogger(),
      true
    );
    expect((await enr.peerId()).toString(), "enr peer id doesn't equal the returned peer id").to.equal(
      peerId.toString()
    );
    expect(enr.seq).to.equal(BigInt(1));
    expect(enr.tcp).to.equal(undefined);
    expect(enr.tcp6).to.equal(undefined);
  });

  it("second time should use ths existing enr and peer id", async () => {
    const run1 = await initPeerIdAndEnr(
      {persistNetworkIdentity: true} as unknown as BeaconArgs,
      tmpDir.name,
      testLogger(),
      true
    );

    const run2 = await initPeerIdAndEnr(
      {persistNetworkIdentity: true} as unknown as BeaconArgs,
      tmpDir.name,
      testLogger(),
      true
    );

    expect(run1.peerId.toString()).to.equal(run2.peerId.toString());
    expect(run1.enr.encodeTxt()).to.equal(run2.enr.encodeTxt());
  });
});
