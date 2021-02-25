import {expect} from "chai";
import PeerId from "peer-id";
import {PeerMap, PeerSet} from "../../../src/util/peerMap";

describe("util / peerMap", () => {
  const peer1 = new PeerId(Buffer.from([0])); // Offset by one, PeerId encodes to B58String 0 as "1"

  describe("PeerMap", () => {
    it("Should compute correct size", () => {
      const peerMap = new PeerMap();
      peerMap.set(peer1, true);
      expect(peerMap.size).to.equal(1, "Wrong peerMap.size");
    });
  });

  describe("PeerSet", () => {
    it("Should compute correct size", () => {
      const peerSet = new PeerSet();
      peerSet.add(peer1);
      expect(peerSet.size).to.equal(1, "Wrong peerSet.size");
    });
  });
});
