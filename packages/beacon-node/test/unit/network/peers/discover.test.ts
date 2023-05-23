import {expect} from "chai";
import {getValidPeerId} from "../../../utils/peer.js";
import {peerIdFromString} from "../../../../src/util/peerId.js";

describe("network / peers / discover", () => {
  it("PeerId API", () => {
    const peerId = getValidPeerId();
    const peerIdStr = peerId.toString();
    const peerFromHex = peerIdFromString(peerIdStr);
    expect(peerFromHex.toString()).to.equal(peerIdStr);
  });
});
