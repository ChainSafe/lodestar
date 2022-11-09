import {expect} from "chai";
import {createSecp256k1PeerId} from "@libp2p/peer-id-factory";
import {PeerMap, PeerSet} from "../../../src/util/peerMap.js";

describe("util / peerMap", async () => {
  const peer1 = await createSecp256k1PeerId();

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
