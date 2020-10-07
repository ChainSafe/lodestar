import {SinonStubbedInstance} from "sinon";
import {INetwork, Libp2pNetwork} from "../../../../src/network";
import sinon from "sinon";
import {getSyncPeers} from "../../../../src/sync/utils/peers";
import {expect} from "chai";
import {generatePeer} from "../../../utils/peer";
import PeerId from "peer-id";
import {IRpcScoreTracker, SimpleRpcScoreTracker} from "../../../../src/network/peers/score";

describe("sync peer utils", function () {
  let networkStub: SinonStubbedInstance<INetwork>;
  let peerScoreStub: SinonStubbedInstance<IRpcScoreTracker>;

  beforeEach(function () {
    networkStub = sinon.createStubInstance(Libp2pNetwork);
    peerScoreStub = sinon.createStubInstance(SimpleRpcScoreTracker);
    networkStub.peerRpcScores = peerScoreStub;
  });

  it("should work without peers", function () {
    networkStub.getPeers.returns([]);
    const result = getSyncPeers(networkStub);
    expect(result.length).to.be.equal(0);
  });

  it("should filter and sort peers", async function () {
    const peers = [
      generatePeer(PeerId.createFromBytes(Buffer.alloc(32, 0))),
      generatePeer(PeerId.createFromBytes(Buffer.alloc(32, 1))),
      generatePeer(PeerId.createFromBytes(Buffer.alloc(32, 2))),
      generatePeer(PeerId.createFromBytes(Buffer.alloc(32, 3))),
      generatePeer(PeerId.createFromBytes(Buffer.alloc(32, 4))),
    ];
    networkStub.getPeers.returns(peers);
    peerScoreStub.getScore.returns(100);
    peerScoreStub.getScore.withArgs(peers[0].id).returns(40);
    peerScoreStub.getScore.withArgs(peers[3].id).returns(120);
    const result = getSyncPeers(networkStub, (id) => id !== peers[1].id, 2, 50);
    expect(result.length).to.be.equal(2);
    expect(result[0]).to.be.equal(peers[3].id);
    expect(result[1]).to.be.equal(peers[2].id);
  });
});
