import {describe, expect, it} from "vitest";
import {peerIdFromString} from "../../../../src/util/peerId.js";
import {getValidPeerId} from "../../../utils/peer.js";

describe("network / peers / discover", () => {
  it("PeerId API", () => {
    const peerId = getValidPeerId();
    const peerIdStr = peerId.toString();
    const peerFromHex = peerIdFromString(peerIdStr);
    expect(peerFromHex.toString()).toBe(peerIdStr);
  });
});
