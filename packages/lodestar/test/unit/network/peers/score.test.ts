import {expect} from "chai";
import PeerId from "peer-id";
import {PeerAction, ScoreState, PeerRpcScoreStore} from "../../../../src/network/peers/score";

describe("simple block provider score tracking", function () {
  const peer = PeerId.createFromB58String("Qma9T5YraSnpRDZqRR4krcSJabThc8nwZuJV3LercPHufi");
  const MIN_SCORE = -100;

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  function mockStore() {
    return {scoreStore: new PeerRpcScoreStore()};
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
      const {scoreStore} = mockStore();
      scoreStore["scores"].set(peer.toB58String(), MIN_SCORE);
      scoreStore["lastUpdate"].set(peer.toB58String(), Date.now() - timeToDecay * factorForJsBadMath);
      scoreStore.update();
      expect(scoreStore.getScore(peer)).to.be.greaterThan(minScore);
    });

  it("should not go belove min score", function () {
    const {scoreStore} = mockStore();
    scoreStore.applyAction(peer, PeerAction.Fatal);
    scoreStore.applyAction(peer, PeerAction.Fatal);
    expect(scoreStore.getScore(peer)).to.be.gte(MIN_SCORE);
  });
});
