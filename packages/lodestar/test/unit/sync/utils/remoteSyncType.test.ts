import {IForkChoice} from "@chainsafe/lodestar-fork-choice";
import {Root, phase0} from "@chainsafe/lodestar-types";
import {toHexString} from "@chainsafe/ssz";
import {expect} from "chai";
import {ZERO_HASH} from "../../../../src/constants";
import {
  getPeerSyncType,
  getRangeSyncType,
  PeerSyncType,
  RangeSyncType,
} from "../../../../src/sync/utils/remoteSyncType";

describe("network / peers / remoteSyncType", () => {
  const slotImportTolerance = 32;
  const knownRoot = Buffer.alloc(32, 1);
  const status: phase0.Status = {
    finalizedEpoch: 0,
    finalizedRoot: ZERO_HASH,
    headSlot: 0,
    headRoot: ZERO_HASH,
    forkDigest: ZERO_HASH,
  };

  describe("getPeerSyncType", () => {
    const testCases: {
      id: string;
      local: Partial<phase0.Status>;
      remote: Partial<phase0.Status>;
      blocks?: Root[];
      syncType: PeerSyncType;
    }[] = [
      {
        id: "Remote has lower finalizedEpoch",
        local: {finalizedEpoch: 10},
        remote: {finalizedEpoch: 10 - 1},
        syncType: PeerSyncType.Behind,
      },
      {
        id: "Remote has same finalizedEpoch and close head",
        local: {finalizedEpoch: 10, headSlot: 10},
        remote: {finalizedEpoch: 10, headSlot: 10 + 1},
        syncType: PeerSyncType.FullySynced,
      },
      {
        id: "Remote has same finalizedEpoch and far head",
        local: {finalizedEpoch: 10, headSlot: 10},
        remote: {finalizedEpoch: 10, headSlot: 10 + 1 + slotImportTolerance},
        syncType: PeerSyncType.Advanced,
      },
      {
        id: "Remote has same finalizedEpoch and far head with known block",
        local: {finalizedEpoch: 10, headSlot: 10},
        remote: {finalizedEpoch: 10, headSlot: 10 + 1 + slotImportTolerance, headRoot: knownRoot},
        blocks: [knownRoot],
        syncType: PeerSyncType.FullySynced,
      },
      {
        id: "Remote has higher finalizedEpoch but is close enough",
        local: {finalizedEpoch: 10, headSlot: 10},
        remote: {finalizedEpoch: 10 + 1, headSlot: 10 + 1},
        syncType: PeerSyncType.FullySynced,
      },
      {
        id: "Remote has higher finalizedEpoch",
        local: {finalizedEpoch: 10},
        remote: {finalizedEpoch: 10 + 5},
        syncType: PeerSyncType.Advanced,
      },
    ];

    for (const {id, local: localPartial, remote: remotePartial, blocks, syncType} of testCases) {
      it(id, () => {
        const local = {...status, ...localPartial};
        const remote = {...status, ...remotePartial};
        const forkChoice = getMockForkChoice(blocks || []);
        expect(getPeerSyncType(local, remote, forkChoice, slotImportTolerance)).to.equal(syncType);
      });
    }
  });

  describe("getRangeSyncType", () => {
    const testCases: {
      id: string;
      local: Partial<phase0.Status>;
      remote: Partial<phase0.Status>;
      blocks?: Root[];
      syncType: RangeSyncType;
    }[] = [
      {
        id: "Remote has lower finalizedEpoch",
        local: {finalizedEpoch: 10},
        remote: {finalizedEpoch: 10 - 1},
        syncType: RangeSyncType.Head,
      },
      {
        id: "Remote has same finalizedEpoch",
        local: {finalizedEpoch: 10},
        remote: {finalizedEpoch: 10},
        syncType: RangeSyncType.Head,
      },
      {
        id: "Remote has higher finalizedEpoch",
        local: {finalizedEpoch: 10},
        remote: {finalizedEpoch: 10 + 1},
        syncType: RangeSyncType.Finalized,
      },
      {
        id: "Remote has higher finalizedEpoch with known block",
        local: {finalizedEpoch: 10},
        remote: {finalizedEpoch: 10 + 1, finalizedRoot: knownRoot},
        blocks: [knownRoot],
        syncType: RangeSyncType.Head,
      },
    ];

    for (const {id, local: localPartial, remote: remotePartial, blocks, syncType} of testCases) {
      it(id, () => {
        const local = {...status, ...localPartial};
        const remote = {...status, ...remotePartial};
        const forkChoice = getMockForkChoice(blocks || []);
        expect(getRangeSyncType(local, remote, forkChoice)).to.equal(syncType);
      });
    }
  });
});

function getMockForkChoice(blocks: Root[]): IForkChoice {
  const blockSet = new Set(blocks.map((blockRoot) => toHexString(blockRoot)));
  return {
    hasBlock: (blockRoot: Root) => blockSet.has(toHexString(blockRoot)),
  } as IForkChoice;
}
