import {existsSync} from "node:fs";
import path from "node:path";
import {expect} from "chai";
import {before, after} from "mocha";
import rimraf from "rimraf";
import PeerId from "peer-id";
import {toHexString} from "@chainsafe/ssz";
import {createKeypairFromPeerId, ENR} from "@chainsafe/discv5";
import {FileENR} from "../../../src/config/index.js";
import {testFilesDir} from "../../utils.js";

describe("fileENR", function () {
  const dataDir = testFilesDir;

  before(async () => {
    await new Promise((resolve) => rimraf(dataDir, resolve));
  });

  after(async () => {
    await new Promise((resolve) => rimraf(dataDir, resolve));
  });

  it("create ENR from file", async function () {
    const peerId = await PeerId.create({keyType: "secp256k1"});
    const enrFilePath = path.join(testFilesDir, "enr_file.txt");

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

function createEnr(peerId: PeerId): ENR {
  const keypair = createKeypairFromPeerId(peerId);
  return ENR.createV4(keypair.publicKey);
}

function initEnr(filepath: string, peerId: PeerId): void {
  FileENR.initFromENR(filepath, peerId, createEnr(peerId) as FileENR).saveToFile();
}
