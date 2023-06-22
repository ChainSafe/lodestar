import {expect} from "chai";
import sinon, {SinonStubbedInstance} from "sinon";
import bls from "@chainsafe/bls";
import {altair} from "@lodestar/types";
import {toHexString} from "@chainsafe/ssz";
import {SyncCommitteeMessagePool} from "../../../../src/chain/opPools/index.js";
import {Clock} from "../../../../src/util/clock.js";

describe("chain / opPools / SyncCommitteeMessagePool", function () {
  const sandbox = sinon.createSandbox();
  let cache: SyncCommitteeMessagePool;
  const subcommitteeIndex = 2;
  const indexInSubcommittee = 3;
  const beaconBlockRoot = Buffer.alloc(32, 1);
  const slot = 10;
  let syncCommittee: altair.SyncCommitteeMessage;
  let clockStub: SinonStubbedInstance<Clock>;
  const cutOffTime = 1;

  before("Init BLS", async () => {
    const sk = bls.SecretKey.fromBytes(Buffer.alloc(32, 1));
    syncCommittee = {
      slot,
      beaconBlockRoot,
      validatorIndex: 2000,
      signature: sk.sign(beaconBlockRoot).toBytes(),
    };
  });

  beforeEach(() => {
    clockStub = sandbox.createStubInstance(Clock);
    cache = new SyncCommitteeMessagePool(clockStub, cutOffTime);
    cache.add(subcommitteeIndex, syncCommittee, indexInSubcommittee);
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("should preaggregate SyncCommitteeContribution", () => {
    clockStub.secFromSlot.returns(0);
    let contribution = cache.getContribution(subcommitteeIndex, syncCommittee.slot, syncCommittee.beaconBlockRoot);
    expect(contribution).to.be.not.null;
    const newSecretKey = bls.SecretKey.fromBytes(Buffer.alloc(32, 2));
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
    expect(contribution).to.be.not.null;
    if (contribution) {
      expect(contribution.slot).to.be.equal(syncCommittee.slot);
      expect(toHexString(contribution.beaconBlockRoot)).to.be.equal(toHexString(syncCommittee.beaconBlockRoot));
      expect(contribution.subcommitteeIndex).to.be.equal(subcommitteeIndex);
      const newIndices = [...newIndicesInSubSyncCommittee, indexInSubcommittee];
      const aggregationBits = contribution.aggregationBits;
      for (let index = 0; index < aggregationBits.bitLen; index++) {
        expect(aggregationBits.get(index)).to.equal(newIndices.includes(index), `Wrong bit value index ${index}`);
      }
    }
  });
});
