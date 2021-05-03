import {expect} from "chai";
import PeerId from "peer-id";
import {PeerAction, ScoreState, PeerRpcScoreStore} from "../../../../src/network/peers/score";
import {IPeerMetadataStore} from "../../../../src/network/peers";

describe("simple block provider score tracking", function () {
  const peer = PeerId.createFromB58String("Qma9T5YraSnpRDZqRR4krcSJabThc8nwZuJV3LercPHufi");
  const MIN_SCORE = -100;

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  function mockStore() {
    const store: IPeerMetadataStore = {
      encoding: new PeerMap<any>(),
      metadata: new PeerMap<any>(),
      rpcScore: new PeerMap<number>(),
      rpcScoreLastUpdate: new PeerMap<number>(),
    };
    return {store, scoreStore: new PeerRpcScoreStore(store)};
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
    it(`Should ban peer after ${times} ${peerAction}`, () => {
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
      const {store, scoreStore} = mockStore();
      store.rpcScore.set(peer, MIN_SCORE);
      store.rpcScoreLastUpdate.set(peer, Date.now() - timeToDecay * factorForJsBadMath);
      scoreStore.update(peer);
      expect(scoreStore.getScore(peer)).to.be.greaterThan(minScore);
    });

  it("should not go belove min score", function () {
    const {scoreStore} = mockStore();
    scoreStore.applyAction(peer, PeerAction.Fatal);
    scoreStore.applyAction(peer, PeerAction.Fatal);
    expect(scoreStore.getScore(peer)).to.be.gte(MIN_SCORE);
  });
});

class PeerMap<T> {
  map = new Map<string, T>();
  get(peer: PeerId): T | undefined {
    return this.map.get(peer.toB58String());
  }
  set(peer: PeerId, value: T): void {
    this.map.set(peer.toB58String(), value);
  }
}
