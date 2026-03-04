import {describe, expect, it} from "vitest";
import {PubkeyIndexMap} from "@chainsafe/pubkey-index-map";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {RootHex} from "@lodestar/types";
import {EpochCache} from "../../../src/cache/epochCache.js";
import {SyncCommitteeCacheEmpty} from "../../../src/cache/syncCommitteeCache.js";
import {EpochShuffling} from "../../../src/util/epochShuffling.js";

const ZERO_ROOT_HEX = ("0x" + "00".repeat(32)) as RootHex;

function createShuffling(epoch: number): EpochShuffling {
  return {
    epoch,
    activeIndices: new Uint32Array([0]),
    shuffling: new Uint32Array([0]),
    committees: Array.from({length: SLOTS_PER_EPOCH}, () => [new Uint32Array([0])]),
    committeesPerSlot: 1,
  };
}

function createEpochCacheForPayloadCommitteeTest(): EpochCache {
  const config = {GLOAS_FORK_EPOCH: 1, ELECTRA_FORK_EPOCH: 0} as any;

  const previousPayloadTimelinessCommittees = Array.from(
    {length: SLOTS_PER_EPOCH},
    (_, i) => new Uint32Array([100 + i])
  );
  const payloadTimelinessCommittees = Array.from({length: SLOTS_PER_EPOCH}, (_, i) => new Uint32Array([200 + i]));

  return new EpochCache({
    config,
    pubkey2index: new PubkeyIndexMap(),
    index2pubkey: [],
    proposers: [0],
    proposersPrevEpoch: [0],
    proposersNextEpoch: {computed: true, indexes: [0]},
    previousDecisionRoot: ZERO_ROOT_HEX,
    currentDecisionRoot: ZERO_ROOT_HEX,
    nextDecisionRoot: ZERO_ROOT_HEX,
    previousShuffling: createShuffling(5),
    currentShuffling: createShuffling(6),
    nextShuffling: createShuffling(7),
    nextActiveIndices: new Uint32Array([0]),
    effectiveBalanceIncrements: new Uint16Array([32]),
    totalSlashingsByIncrement: 0,
    syncParticipantReward: 0,
    syncProposerReward: 0,
    baseRewardPerIncrement: 0,
    totalActiveBalanceIncrements: 1,
    churnLimit: 1,
    activationChurnLimit: 1,
    exitQueueEpoch: 0,
    exitQueueChurn: 0,
    currentTargetUnslashedBalanceIncrements: 0,
    previousTargetUnslashedBalanceIncrements: 0,
    currentSyncCommitteeIndexed: new SyncCommitteeCacheEmpty(),
    nextSyncCommitteeIndexed: new SyncCommitteeCacheEmpty(),
    previousPayloadTimelinessCommittees,
    payloadTimelinessCommittees,
    epoch: 6,
    syncPeriod: 0,
  });
}

describe("EpochCache.getPayloadTimelinessCommittee", () => {
  it("returns PTC for previous epoch slot (epoch boundary previous slot)", () => {
    const epochCtx = createEpochCacheForPayloadCommitteeTest();
    const previousSlot = epochCtx.epoch * SLOTS_PER_EPOCH - 1;

    expect(epochCtx.getPayloadTimelinessCommittee(previousSlot)).toEqual(
      epochCtx.previousPayloadTimelinessCommittees[previousSlot % SLOTS_PER_EPOCH]
    );
  });

  it("returns PTC for current epoch slot", () => {
    const epochCtx = createEpochCacheForPayloadCommitteeTest();
    const currentSlot = epochCtx.epoch * SLOTS_PER_EPOCH;

    expect(epochCtx.getPayloadTimelinessCommittee(currentSlot)).toEqual(
      epochCtx.payloadTimelinessCommittees[currentSlot % SLOTS_PER_EPOCH]
    );
  });

  it("throws for slots older than previous epoch", () => {
    const epochCtx = createEpochCacheForPayloadCommitteeTest();
    const tooOldSlot = (epochCtx.epoch - 2) * SLOTS_PER_EPOCH;

    expect(() => epochCtx.getPayloadTimelinessCommittee(tooOldSlot)).toThrow(
      `Payload Timeliness Committee is not available for slot=${tooOldSlot}`
    );
  });
});
