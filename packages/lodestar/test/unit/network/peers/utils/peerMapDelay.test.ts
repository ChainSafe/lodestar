import {expect} from "chai";
import sinon from "sinon";
import PeerId from "peer-id";
import {PeerMapDelay} from "../../../../../src/network/peers/utils";
import {before} from "mocha";

describe("network / peers / utils / PeerMapDelay", () => {
  const INTERVAL = 10 * 1000;
  const OFFSET = INTERVAL / 2;
  const peer = new PeerId(Buffer.from("peer-1"));
  peer.toB58String = () => "peer-1";
  let clock: sinon.SinonFakeTimers;

  before(() => (clock = sinon.useFakeTimers()));
  after(() => clock.restore());

  it("Should request peer immediatelly", () => {
    const peerMapDelay = new PeerMapDelay(INTERVAL);
    peerMapDelay.requestNow(peer);
    expectNext(peerMapDelay, [peer], "Peer must be ready now");
    expectNext(peerMapDelay, [], "Peer must not be ready after pollNext");
  });

  it("Should request peer on next INTERVAL", () => {
    const peerMapDelay = new PeerMapDelay(INTERVAL);
    peerMapDelay.requestAfter(peer);
    expectNext(peerMapDelay, [], "Peer must not be ready now");

    clock.tick(INTERVAL + 1);
    expectNext(peerMapDelay, [peer], "Peer must be ready after INTERVAL");
  });

  it("Should request peer after OFFSET", () => {
    const peerMapDelay = new PeerMapDelay(INTERVAL);
    peerMapDelay.requestAfter(peer, OFFSET);
    expectNext(peerMapDelay, [], "Peer must not be ready now");

    clock.tick(OFFSET + 1);
    expectNext(peerMapDelay, [peer], "Peer must be ready after OFFSET");
  });

  function expectNext(peerMapDelay: PeerMapDelay, peers: PeerId[], message?: string): void {
    expect(peerMapDelay.pollNext().map(toId)).to.deep.equal(peers.map(toId), message);
  }

  function toId(peer: PeerId): string {
    return peer.toB58String();
  }
});
