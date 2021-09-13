import {expect} from "chai";
import PeerId from "peer-id";
import {getValidPeerId} from "../../../utils/peer";

describe("network / peers / discover", () => {
  it("PeerId API", () => {
    const peerId = getValidPeerId();
    const peerIdStr = peerId.toB58String();
    const peerFromHex = PeerId.createFromB58String(peerIdStr);
    expect(peerFromHex.toB58String()).to.equal(peerIdStr);
  });
});
