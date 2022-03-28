import {expect} from "chai";
import PeerId from "peer-id";
import sinon from "sinon";
import {PeerAction, ScoreState, PeerRpcScoreStore, updateGossipsubScores} from "../../../../src/network/peers/score";

describe("simple block provider score tracking", function () {
  const peer = PeerId.createFromB58String("Qma9T5YraSnpRDZqRR4krcSJabThc8nwZuJV3LercPHufi");
  const MIN_SCORE = -100;

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  function mockStore() {
    const scoreStore = new PeerRpcScoreStore();
    const peerScores = scoreStore["scores"];
    return {scoreStore, peerScores};
  }

  it("Should return default score, without any previous action", function () {
    const {scoreStore} = mockStore();
    const score = scoreStore.getScore(peer);
    expect(score).to.be.equal(0);
  });

  const timesToBan: [PeerAction, number][] = [
    [PeerAction.Fatal, 1],
    [PeerAction.LowToleranceError, 5],
    [PeerAction.MidToleranceError, 10],
    [PeerAction.HighToleranceError, 50],
  ];

  for (const [peerAction, times] of timesToBan)
    it(`Should ban peer after ${times} ${peerAction}`, async () => {
      const {scoreStore} = mockStore();
      for (let i = 0; i < times; i++) scoreStore.applyAction(peer, peerAction);
      expect(scoreStore.getScoreState(peer)).to.be.equal(ScoreState.Banned);
    });

  const factorForJsBadMath = 1.1;
  const decayTimes: [number, number][] = [
    // [MinScore, timeToDecay]
    [-50, 10 * 60 * 1000],
    [-25, 20 * 60 * 1000],
    [-5, 40 * 60 * 1000],
  ];
  for (const [minScore, timeToDecay] of decayTimes)
    it(`Should decay MIN_SCORE to ${minScore} after ${timeToDecay} ms`, () => {
      const {scoreStore, peerScores} = mockStore();
      const peerScore = peerScores.get(peer.toB58String());
      if (peerScore) {
        peerScore["lastUpdate"] = Date.now() - timeToDecay * factorForJsBadMath;
        peerScore["lodestarScore"] = MIN_SCORE;
      }
      scoreStore.update();
      expect(scoreStore.getScore(peer)).to.be.greaterThan(minScore);
    });

  it("should not go below min score", function () {
    const {scoreStore} = mockStore();
    scoreStore.applyAction(peer, PeerAction.Fatal);
    scoreStore.applyAction(peer, PeerAction.Fatal);
    expect(scoreStore.getScore(peer)).to.be.gte(MIN_SCORE);
  });
});

describe("updateGossipsubScores", function () {
  const sandbox = sinon.createSandbox();
  const peerRpcScoresStub = sandbox.createStubInstance(PeerRpcScoreStore);

  this.afterEach(() => {
    sandbox.restore();
  });

  it("should update gossipsub peer scores", () => {
    updateGossipsubScores(
      peerRpcScoresStub,
      new Map([
        ["a", 10],
        ["b", -10],
        ["c", -20],
        ["d", -5],
      ]),
      2
    );
    expect(peerRpcScoresStub.updateGossipsubScore.calledWith("a", 10, false)).to.be.true;
    // should ignore b d since they are 2 biggest negative scores
    expect(peerRpcScoresStub.updateGossipsubScore.calledWith("b", -10, true)).to.be.true;
    expect(peerRpcScoresStub.updateGossipsubScore.calledWith("d", -5, true)).to.be.true;
    // should not ignore c as it's lowest negative scores
    expect(peerRpcScoresStub.updateGossipsubScore.calledWith("c", -20, false)).to.be.true;
  });
});
