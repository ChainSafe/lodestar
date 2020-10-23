import {toHexString} from "@chainsafe/ssz";
import {expect} from "chai";
import {existsSync} from "fs";
import {initEnr, initPeerId, readPeerId} from "../../../src/network";
import {FileENR} from "../../../src/network/fileEnr";
import {rootDir} from "../../constants";

describe("fileENR", function () {
  it("create ENR from file", async function () {
    const enrFilePath = `${rootDir}/enr`;
    const peerIdFile = `${rootDir}/peer-id.json`;
    await initPeerId(peerIdFile);
    const peerId = await readPeerId(peerIdFile);
    await initEnr(enrFilePath, peerId);
    const enr = FileENR.initFromFile(enrFilePath, peerId);
    const newValue = new Uint8Array(55);
    enr.set("tcp", newValue);
    expect(existsSync(enrFilePath)).to.be.true;
    const updatedEnr = FileENR.initFromFile(enrFilePath, peerId);
    expect(updatedEnr.get("tcp")).to.not.be.undefined;
    expect(toHexString(updatedEnr.get("tcp") as Uint8Array) === toHexString(newValue)).to.be.true;
  });
});
