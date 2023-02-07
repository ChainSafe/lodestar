import {expect} from "chai";
import {peerIdFromString} from "@libp2p/peer-id";
import sinon from "sinon";
import {PeerAction, ScoreState, PeerRpcScoreStore, updateGossipsubScores} from "../../../../src/network/peers/score.js";

describe("simple block provider score tracking", function () {
  const peer = peerIdFromString("Qma9T5YraSnpRDZqRR4krcSJabThc8nwZuJV3LercPHufi");
  const MIN_SCORE = -100;
  const actionName = "test-action";

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
      for (let i = 0; i < times; i++) scoreStore.applyAction(peer, peerAction, actionName);
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
      const peerScore = peerScores.get(peer.toString());
      if (peerScore) {
        peerScore["lastUpdate"] = Date.now() - timeToDecay * factorForJsBadMath;
        peerScore["lodestarScore"] = MIN_SCORE;
      }
      scoreStore.update();
      expect(scoreStore.getScore(peer)).to.be.greaterThan(minScore);
    });

  it("should not go below min score", function () {
    const {scoreStore} = mockStore();
    scoreStore.applyAction(peer, PeerAction.Fatal, actionName);
    scoreStore.applyAction(peer, PeerAction.Fatal, actionName);
    expect(scoreStore.getScore(peer)).to.be.gte(MIN_SCORE);
  });
});

describe("updateGossipsubScores", function () {
  const sandbox = sinon.createSandbox();
  let peerRpcScoresStub: PeerRpcScoreStore;
  beforeEach(() => {
    peerRpcScoresStub = sandbox.createStubInstance(PeerRpcScoreStore);
  });

  this.afterEach(() => {
    sandbox.restore();
  });

  const testCases: {name: string; peerScores: [string, number, boolean][]; maxIgnore: number}[] = [
    {
      name: "Should NOT ignore negative score of <= -1000",
      peerScores: [
        ["a", 10, false],
        // ignore the next 3 because maxIgnore is 5
        ["b", -10, true],
        ["c", -20, true],
        ["d", -5, true],
        // not ignore because score is low
        ["e", -1000, false],
      ],
      maxIgnore: 5,
    },
    {
      name: "Should NOT ignore last negative score",
      peerScores: [
        ["a", 10, false],
        // ignore the next 3 because maxIgnore is 5
        ["b", -10, true],
        ["c", -20, true],
        ["d", -5, true],
        // not ignore because maxIgnore is 3
        ["e", -30, false],
      ],
      maxIgnore: 3,
    },
  ];

  for (const {name, peerScores, maxIgnore} of testCases) {
    it(name, () => {
      const peerScoreMap = new Map<string, number>();
      for (const [key, value] of peerScores) {
        peerScoreMap.set(key, value);
      }
      updateGossipsubScores(peerRpcScoresStub, peerScoreMap, maxIgnore);
      for (const [key, value, ignore] of peerScores) {
        expect(peerRpcScoresStub.updateGossipsubScore).to.be.calledWith(key, value, ignore);
      }
    });
  }
});
