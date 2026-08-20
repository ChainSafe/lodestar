import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {MapDef} from "@lodestar/utils";
import {
  MAX_PENALTY_ACTIONS_PER_PEER,
  REPEAT_PENALTY_COOLDOWN_MS,
} from "../../../../src/network/peers/score/constants.js";
import {
  PeerAction,
  PeerRpcScoreStore,
  RealScore,
  ScoreState,
  updateGossipsubScores,
} from "../../../../src/network/peers/score/index.js";
import {peerIdFromString} from "../../../../src/util/peerId.js";

vi.mock("../../../../src/network/peers/score/index.js", async (importActual) => {
  const mod = await importActual<typeof import("../../../../src/network/peers/score/index.js")>();

  vi.spyOn(mod.PeerRpcScoreStore.prototype, "updateGossipsubScore").mockImplementation(() => {});

  return {
    ...mod,
  };
});

describe("simple block provider score tracking", () => {
  const peer = peerIdFromString("Qma9T5YraSnpRDZqRR4krcSJabThc8nwZuJV3LercPHufi");
  const MIN_SCORE = -100;
  const actionName = "test-action";

  function mockStore() {
    const scoreStore = new PeerRpcScoreStore();
    const peerScores = scoreStore["scores"] as MapDef<string, RealScore>;
    return {scoreStore, peerScores};
  }

  it("Should return default score, without any previous action", () => {
    const {scoreStore} = mockStore();
    const score = scoreStore.getScore(peer);
    expect(score).toBe(0);
  });

  const timesToBan: [PeerAction, number][] = [
    [PeerAction.Fatal, 1],
    [PeerAction.LowToleranceError, 5],
    [PeerAction.MidToleranceError, 10],
    [PeerAction.HighToleranceError, 50],
  ];

  for (const [peerAction, times] of timesToBan)
    it(`Should ban peer after ${times} ${peerAction}`, async () => {
      vi.useFakeTimers();
      const {scoreStore} = mockStore();
      for (let i = 0; i < times; i++) {
        scoreStore.applyAction(peer, peerAction, actionName);
        // repeats of the same action are rate limited, space them beyond the cooldown
        vi.advanceTimersByTime(REPEAT_PENALTY_COOLDOWN_MS);
      }
      expect(scoreStore.getScoreState(peer)).toBe(ScoreState.Banned);
      vi.useRealTimers();
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
      expect(scoreStore.getScore(peer)).toBeGreaterThan(minScore);
    });

  it("should not go below min score", () => {
    const {scoreStore} = mockStore();
    scoreStore.applyAction(peer, PeerAction.Fatal, actionName);
    scoreStore.applyAction(peer, PeerAction.Fatal, actionName);
    expect(scoreStore.getScore(peer)).toBeGreaterThanOrEqual(MIN_SCORE);
  });
});

describe("peer score penalty rate limiting", () => {
  const peer = peerIdFromString("Qma9T5YraSnpRDZqRR4krcSJabThc8nwZuJV3LercPHufi");
  const actionName = "REQUEST_ERROR_DIAL_TIMEOUT";

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("Should apply the same action only once per cooldown", () => {
    const scoreStore = new PeerRpcScoreStore();
    for (let i = 0; i < 20; i++) scoreStore.applyAction(peer, PeerAction.LowToleranceError, actionName);

    expect(scoreStore.getScore(peer)).toBe(-10);
    expect(scoreStore.getScoreState(peer)).toBe(ScoreState.Healthy);
  });

  it("Should apply the same action again after the cooldown", () => {
    const scoreStore = new PeerRpcScoreStore();
    scoreStore.applyAction(peer, PeerAction.LowToleranceError, actionName);
    vi.advanceTimersByTime(REPEAT_PENALTY_COOLDOWN_MS);
    scoreStore.applyAction(peer, PeerAction.LowToleranceError, actionName);

    expect(scoreStore.getScore(peer)).toBe(-20);
  });

  it("Should not rate limit distinct actions", () => {
    const scoreStore = new PeerRpcScoreStore();
    for (const reason of ["a", "b", "c", "d", "e"]) {
      scoreStore.applyAction(peer, PeerAction.LowToleranceError, reason);
    }

    expect(scoreStore.getScoreState(peer)).toBe(ScoreState.Banned);
  });

  it("Should bound tracked action names per peer", () => {
    const scoreStore = new PeerRpcScoreStore();
    for (let i = 0; i < MAX_PENALTY_ACTIONS_PER_PEER * 2; i++) {
      scoreStore.applyAction(peer, PeerAction.HighToleranceError, `action-${i}`);
    }
    const lastPenalties = (scoreStore["lastPenaltyMs"] as MapDef<string, Map<string, number>>).get(peer.toString());

    expect(lastPenalties?.size).toBe(MAX_PENALTY_ACTIONS_PER_PEER);
  });

  it("Should never suppress Fatal", () => {
    const scoreStore = new PeerRpcScoreStore();
    scoreStore.applyAction(peer, PeerAction.LowToleranceError, actionName);
    scoreStore.applyAction(peer, PeerAction.Fatal, actionName);

    expect(scoreStore.getScoreState(peer)).toBe(ScoreState.Banned);
  });
});

describe("updateGossipsubScores", () => {
  let peerRpcScoresStub: PeerRpcScoreStore;

  beforeEach(() => {
    peerRpcScoresStub = vi.mocked(new PeerRpcScoreStore());
  });

  afterEach(() => {
    vi.clearAllMocks();
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
        expect(peerRpcScoresStub.updateGossipsubScore).toHaveBeenCalledWith(key, value, ignore);
      }
    });
  }
});
