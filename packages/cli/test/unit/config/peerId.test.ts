import {expect} from "chai";
import {getTestdirPath} from "../../utils.js";
import {createSecp256k1PeerId, writePeerId, readPeerId} from "../../../src/config/index.js";

describe("config / peerId", () => {
  const peerIdFilepath = getTestdirPath("./test-peer-id.json");

  it("create, write and read PeerId", async () => {
    const peerId = await createSecp256k1PeerId();
    writePeerId(peerIdFilepath, peerId);
    const peerIdRead = await readPeerId(peerIdFilepath);

    expect(peerIdRead.toString()).to.equal(peerId.toString());
  });
});
