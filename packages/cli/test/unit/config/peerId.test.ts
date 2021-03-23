import {expect} from "chai";
import {getTestdirPath} from "../../utils";
import {createPeerId, writePeerId, readPeerId} from "../../../src/config";

describe("config / peerId", () => {
  const peerIdFilepath = getTestdirPath("./test-peer-id.json");

  it("create, write and read PeerId", async () => {
    const peerId = await createPeerId();
    writePeerId(peerIdFilepath, peerId);
    const peerIdRead = await readPeerId(peerIdFilepath);

    expect(peerIdRead.toB58String()).to.equal(peerId.toB58String());
  });
});
