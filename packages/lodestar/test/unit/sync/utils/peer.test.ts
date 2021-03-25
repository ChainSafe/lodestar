import {SinonStubbedInstance} from "sinon";
import {INetwork, Network} from "../../../../src/network";
import {getSyncPeers} from "../../../../src/sync/utils/peers";
import {expect} from "chai";
import PeerId from "peer-id";
import {IPeerRpcScoreStore, PeerRpcScoreStore, ScoreState} from "../../../../src/network/peers/score";
import sinon from "sinon";

describe("sync peer utils", function () {
  let networkStub: SinonStubbedInstance<INetwork>;
  let peerScoreStub: SinonStubbedInstance<IPeerRpcScoreStore>;

  beforeEach(function () {
    networkStub = sinon.createStubInstance(Network);
    peerScoreStub = sinon.createStubInstance(PeerRpcScoreStore);
    networkStub.peerRpcScores = peerScoreStub;
  });

  it("should work without peers", function () {
    networkStub.getConnectedPeers.returns([]);
    const result = getSyncPeers(networkStub);
    expect(result.length).to.be.equal(0);
  });

  it("should filter and sort peers", function () {
    const peers = [
      PeerId.createFromBytes(Buffer.alloc(32, 0)),
      PeerId.createFromBytes(Buffer.alloc(32, 1)),
      PeerId.createFromBytes(Buffer.alloc(32, 2)),
      PeerId.createFromBytes(Buffer.alloc(32, 3)),
      PeerId.createFromBytes(Buffer.alloc(32, 4)),
    ];
    networkStub.getConnectedPeers.returns(peers);
    peerScoreStub.getScoreState.returns(ScoreState.Banned);
    peerScoreStub.getScoreState.withArgs(peers[2]).returns(ScoreState.Healthy);
    const result = getSyncPeers(networkStub, (id) => id !== peers[1], 1);
    expect(result.length).to.be.equal(1);
    expect(result[0]).to.be.equal(peers[2]);
  });
});
