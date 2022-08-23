import {existsSync} from "node:fs";
import {expect} from "chai";
import {before, after} from "mocha";
import rimraf from "rimraf";
import {toHexString} from "@chainsafe/ssz";
import {initEnr, initPeerId, readPeerId, FileENR} from "../../../src/config/index.js";
import {testFilesDir} from "../../utils.js";
import {getBeaconPaths} from "../../../src/cmds/beacon/paths.js";

describe("fileENR", function () {
  const dataDir = testFilesDir;

  before(async () => {
    await new Promise((resolve) => rimraf(dataDir, resolve));
  });

  after(async () => {
    await new Promise((resolve) => rimraf(dataDir, resolve));
  });

  it("create ENR from file", async function () {
    const beaconPaths = getBeaconPaths({dataDir});
    const enrFilePath = beaconPaths.enrFile;
    const peerIdFile = beaconPaths.peerIdFile;
    await initPeerId(peerIdFile);
    const peerId = await readPeerId(peerIdFile);
    initEnr(enrFilePath, peerId);
    const enr = FileENR.initFromFile(enrFilePath, peerId);
    const newValue = new Uint8Array(55);
    enr.set("tcp", newValue);
    expect(existsSync(enrFilePath), `ENR does not exist at ${enrFilePath}`).to.equal(true);
    const updatedEnr = FileENR.initFromFile(enrFilePath, peerId);
    expect(updatedEnr.get("tcp")).to.not.be.undefined;
    expect(toHexString(updatedEnr.get("tcp") as Uint8Array) === toHexString(newValue)).to.equal(true);
  });
});
