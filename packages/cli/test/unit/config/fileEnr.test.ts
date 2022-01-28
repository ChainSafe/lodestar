import {toHexString} from "@chainsafe/ssz";
import {expect} from "chai";
import {before, after} from "mocha";
import {existsSync} from "node:fs";
import rimraf from "rimraf";
import {initEnr, initPeerId, readPeerId, FileENR} from "../../../src/config";
import {testFilesDir} from "../../utils";
import {getBeaconPaths} from "../../../src/cmds/beacon/paths";

describe("fileENR", function () {
  const rootDir = testFilesDir;

  before(async () => {
    await new Promise((resolve) => rimraf(rootDir, resolve));
  });

  after(async () => {
    await new Promise((resolve) => rimraf(rootDir, resolve));
  });

  it("create ENR from file", async function () {
    const beaconPaths = getBeaconPaths({rootDir});
    const enrFilePath = beaconPaths.enrFile;
    const peerIdFile = beaconPaths.peerIdFile;
    await initPeerId(peerIdFile);
    const peerId = await readPeerId(peerIdFile);
    initEnr(enrFilePath, peerId);
    const enr = FileENR.initFromFile(enrFilePath, peerId);
    const newValue = new Uint8Array(55);
    enr.set("tcp", newValue);
    expect(existsSync(enrFilePath), `ENR does not exist at ${enrFilePath}`).to.be.true;
    const updatedEnr = FileENR.initFromFile(enrFilePath, peerId);
    expect(updatedEnr.get("tcp")).to.not.be.undefined;
    expect(toHexString(updatedEnr.get("tcp") as Uint8Array) === toHexString(newValue)).to.be.true;
  });
});
