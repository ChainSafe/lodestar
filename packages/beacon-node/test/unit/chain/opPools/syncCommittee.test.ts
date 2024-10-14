import {toHexString} from "@chainsafe/ssz";
import {describe, it, expect, beforeEach, beforeAll, afterEach, vi, MockedObject} from "vitest";
import {SecretKey} from "@chainsafe/blst";
import {altair} from "@lodestar/types";
import {SyncCommitteeMessagePool} from "../../../../src/chain/opPools/index.js";
import {Clock} from "../../../../src/util/clock.js";

vi.mock("../../../../src/util/clock.js");

describe("chain / opPools / SyncCommitteeMessagePool", () => {
  let cache: SyncCommitteeMessagePool;
  const subcommitteeIndex = 2;
  const indexInSubcommittee = 3;
  const beaconBlockRoot = Buffer.alloc(32, 1);
  const slot = 10;
  let syncCommittee: altair.SyncCommitteeMessage;
  let clockStub: MockedObject<Clock>;
  const cutOffTime = 1;

  beforeAll(async () => {
    const sk = SecretKey.fromBytes(Buffer.alloc(32, 1));
    syncCommittee = {
      slot,
      beaconBlockRoot,
      validatorIndex: 2000,
      signature: sk.sign(beaconBlockRoot).toBytes(),
    };
  });

  beforeEach(() => {
    clockStub = vi.mocked(new Clock({} as any));
    cache = new SyncCommitteeMessagePool(clockStub, cutOffTime);
    cache.add(subcommitteeIndex, syncCommittee, indexInSubcommittee);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.clearAllMocks();
  });

  it("should propagate SyncCommitteeContribution", () => {
    clockStub.secFromSlot.mockReturnValue(0);
    let contribution = cache.getContribution(subcommitteeIndex, syncCommittee.slot, syncCommittee.beaconBlockRoot);
    expect(contribution).not.toBeNull();
    const newSecretKey = SecretKey.fromBytes(Buffer.alloc(32, 2));
    const newSyncCommittee: altair.SyncCommitteeMessage = {
      slot: syncCommittee.slot,
      beaconBlockRoot,
      // different validatorIndex
      validatorIndex: syncCommittee.validatorIndex + 1,
      signature: newSecretKey.sign(beaconBlockRoot).toBytes(),
    };
    const newIndicesInSubSyncCommittee = [1];
    cache.add(subcommitteeIndex, newSyncCommittee, newIndicesInSubSyncCommittee[0]);
    contribution = cache.getContribution(subcommitteeIndex, syncCommittee.slot, syncCommittee.beaconBlockRoot);
    expect(contribution).not.toBeNull();
    if (contribution) {
      expect(contribution.slot).toBe(syncCommittee.slot);
      expect(toHexString(contribution.beaconBlockRoot)).toBe(toHexString(syncCommittee.beaconBlockRoot));
      expect(contribution.subcommitteeIndex).toBe(subcommitteeIndex);
      const newIndices = [...newIndicesInSubSyncCommittee, indexInSubcommittee];
      const aggregationBits = contribution.aggregationBits;
      for (let index = 0; index < aggregationBits.bitLen; index++) {
        expect(aggregationBits.get(index)).toBe(newIndices.includes(index));
      }
    }
  });
});
