import {expect} from "chai";
import {getTestdirPath} from "../../utils.js";
import {createSecp256k1PeerId, createEnr, writeEnr, readEnr} from "../../../src/config/index.js";

describe("config / enr", () => {
  const enrFilepath = getTestdirPath("./test-enr.json");

  it("create, write and read ENR", async () => {
    const peerId = await createSecp256k1PeerId();
    const enr = createEnr(peerId);
    writeEnr(enrFilepath, enr, peerId);
    const enrRead = readEnr(enrFilepath);

    // TODO: Better assertion
    expect(enrRead).to.be.ok;
  });
});
