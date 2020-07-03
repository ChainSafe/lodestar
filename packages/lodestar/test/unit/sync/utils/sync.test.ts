import {describe} from "mocha";
import {IReputation} from "../../../../src/sync/IReputation";
import {Checkpoint, Status} from "@chainsafe/lodestar-types";
import {
  fetchBlockChunks,
  getCommonFinalizedCheckpoint,
  getHighestCommonSlot,
  getStatusFinalizedCheckpoint,
  processSyncBlocks,
  targetSlotToBlockChunks
} from "../../../../src/sync/utils";
import {expect} from "chai";
import deepmerge from "deepmerge";
import * as blockUtils from "../../../../src/sync/utils/blocks";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {isPlainObject} from "@chainsafe/lodestar-utils";
import pipe from "it-pipe";
import sinon, {SinonFakeTimers, SinonStub, SinonStubbedInstance} from "sinon";
import {BeaconChain, IBeaconChain, ILMDGHOST, StatefulDagLMDGHOST} from "../../../../src/chain";
import {collect} from "../../chain/blocks/utils";
import {generateState} from "../../../utils/state";
import {ReqResp} from "../../../../src/network/reqResp";
import {generateEmptySignedBlock} from "../../../utils/block";
import {WinstonLogger} from "@chainsafe/lodestar-utils/lib/logger";
import PeerInfo from "peer-info";

describe("sync utils", function () {

  let timer: SinonFakeTimers;

  beforeEach(function () {
    timer = sinon.useFakeTimers();
  });

  after(function () {
    timer.restore();
  });

  describe("get highest common slot", function () {
    it("no pears", function () {
      const result = getHighestCommonSlot([]);
      expect(result).to.be.equal(0);
    });

    it("no statuses", function () {
      const result = getHighestCommonSlot([generateReputation({latestStatus: null})]);
      expect(result).to.be.equal(0);
    });

    it("single rep", function () {
      const result = getHighestCommonSlot([generateReputation({latestStatus: generateStatus({headSlot: 10})})]);
      expect(result).to.be.equal(10);
    });

    it("majority", function () {
      const reps = [
        generateReputation({latestStatus: generateStatus({headSlot: 10})}),
        generateReputation({latestStatus: generateStatus({headSlot: 10})}),
        generateReputation({latestStatus: generateStatus({headSlot: 12})})
      ];
      const result = getHighestCommonSlot(reps);
      expect(result).to.be.equal(10);
    });

    //It should be 10 as it's highest common slot, we need better algo for that to consider
    it.skip("disagreement", function () {
      const reps = [
        generateReputation({latestStatus: generateStatus({headSlot: 12})}),
        generateReputation({latestStatus: generateStatus({headSlot: 10})}),
        generateReputation({latestStatus: generateStatus({headSlot: 11})}),
      ];
      const result = getHighestCommonSlot(reps);
      expect(result).to.be.equal(10);
    });
  });

  it("status to finalized checkpoint", function () {
    const checkpoint: Checkpoint = {
      epoch: 1,
      root: Buffer.alloc(32, 4)
    };
    const status = generateStatus({finalizedEpoch: checkpoint.epoch, finalizedRoot: checkpoint.root});
    const result = getStatusFinalizedCheckpoint(status);
    expect(config.types.Checkpoint.equals(result, checkpoint)).to.be.true;
  });

  describe("get common finalized checkpoint", function () {

    it("no peers", function () {
      const result = getCommonFinalizedCheckpoint(config, []);
      expect(result).to.be.null;
    });

    it("no statuses", function () {
      const result = getCommonFinalizedCheckpoint(config, [generateReputation({latestStatus: null})]);
      expect(result).to.be.null;
    });

    it("single peer", function () {
      const checkpoint: Checkpoint = {
        epoch: 1,
        root: Buffer.alloc(32, 4)
      };
      const result = getCommonFinalizedCheckpoint(
        config,
        [generateReputation({
          latestStatus: generateStatus({
            finalizedEpoch: checkpoint.epoch,
            finalizedRoot: checkpoint.root
          })
        })]
      );
      expect(config.types.Checkpoint.equals(checkpoint, result)).to.be.true;
    });

    it("majority", function () {
      const checkpoint: Checkpoint = {
        epoch: 1,
        root: Buffer.alloc(32, 4)
      };
      const result = getCommonFinalizedCheckpoint(
        config,
        [
          generateReputation({
            latestStatus: generateStatus({
              finalizedEpoch: checkpoint.epoch,
              finalizedRoot: checkpoint.root
            })
          }),
          generateReputation({
            latestStatus: generateStatus({
              finalizedEpoch: checkpoint.epoch,
              finalizedRoot: checkpoint.root
            })
          }),
          generateReputation({
            latestStatus: generateStatus({
              finalizedEpoch: 4,
              finalizedRoot: Buffer.alloc(32)
            })
          })
        ]
      );
      expect(config.types.Checkpoint.equals(checkpoint, result)).to.be.true;
    });

  });

  describe("targetSlotToBlockChunks process", function () {

    let chainStub: SinonStubbedInstance<IBeaconChain>;

    beforeEach(function () {
      chainStub = sinon.createStubInstance(BeaconChain);
    });

    it("should work target less than epoch slots", async function () {
      chainStub.getHeadStateContext.resolves(generateState({slot: 0}));
      const chunks = await pipe(
        [5],
        targetSlotToBlockChunks(config, chainStub, async () => [{id: 2} as unknown as PeerInfo]),
        collect
      );
      expect(chunks.length).to.be.equal(1);
    });

    it("should work target greater than epoch slots", async function () {
      chainStub.getHeadStateContext.resolves(generateState({slot: 0}));
      const chunks = await pipe(
        [config.params.SLOTS_PER_EPOCH + 2],
        targetSlotToBlockChunks(config, chainStub, async () => [{id: 2} as unknown as PeerInfo]),
        collect
      );
      expect(chunks.length).to.be.equal(1);
    });
  });

  describe("fetchBlockChunk process", function () {

    const sandbox = sinon.createSandbox();

    let getPeersStub: SinonStub, getBlockRangeStub: SinonStub;

    beforeEach(function () {
      getPeersStub = sinon.stub();
      getBlockRangeStub = sandbox.stub(blockUtils, "getBlockRange");
    });

    afterEach(function () {
      sandbox.restore();
    });

    it("no peers", async function () {
      getPeersStub.resolves([]);
      getBlockRangeStub.resolves([generateEmptySignedBlock()]);
      let result = pipe(
        [{start: 0, end: 10}],
        fetchBlockChunks(
          sinon.createStubInstance(WinstonLogger),
          sinon.createStubInstance(BeaconChain),
          sinon.createStubInstance(ReqResp), getPeersStub),
        collect
      );
      await timer.tickAsync(30000);
      result = await result;
      expect(result.length).to.be.equal(0);
    });

    it("happy path", async function () {
      getPeersStub.resolves([{}]);
      getBlockRangeStub.resolves([generateEmptySignedBlock()]);
      const result = await pipe(
        [{start: 0, end: 10}],
        fetchBlockChunks(
          sinon.createStubInstance(WinstonLogger),
          sinon.createStubInstance(BeaconChain),
          sinon.createStubInstance(ReqResp), getPeersStub),
        collect
      );
      expect(result.length).to.be.equal(1);
      expect(getBlockRangeStub.calledOnce).to.be.true;
    });

  });

  describe("block process", function () {

    let chainStub: SinonStubbedInstance<IBeaconChain>;
    let forkChoiceStub: SinonStubbedInstance<ILMDGHOST>;

    beforeEach(function () {
      chainStub = sinon.createStubInstance(BeaconChain);
      forkChoiceStub = sinon.createStubInstance(StatefulDagLMDGHOST);
      chainStub.forkChoice = forkChoiceStub;
    });

    it("should work", async function () {
      forkChoiceStub.headBlockRoot.returns(generateEmptySignedBlock().message.parentRoot.valueOf() as Uint8Array);
      const block1 = generateEmptySignedBlock();
      const block2 = generateEmptySignedBlock();
      block2.message.slot = 3;
      block2.message.parentRoot = config.types.BeaconBlock.hashTreeRoot(block1.message);
      await pipe(
        [[block2], [block1]],
        processSyncBlocks(
          config, chainStub, sinon.createStubInstance(WinstonLogger))
      );
      expect(chainStub.receiveBlock.calledTwice).to.be.true;
    });

  });

});

function generateReputation(overiddes: Partial<IReputation>): IReputation {
  return deepmerge(
    {
      score: 1,
      latestMetadata: null,
      latestStatus: {
        finalizedEpoch: 0,
        finalizedRoot: Buffer.alloc(1),
        headForkVersion: Buffer.alloc(4),
        headRoot: Buffer.alloc(1),
        headSlot: 0
      }
    },
    overiddes,
    {isMergeableObject: isPlainObject}
  );
}

function generateStatus(overiddes: Partial<Status>): Status {
  return deepmerge(
    {
      finalizedEpoch: 0,
      finalizedRoot: Buffer.alloc(1),
      headForkVersion: Buffer.alloc(4),
      headRoot: Buffer.alloc(1),
      headSlot: 0
    },
    overiddes,
    {isMergeableObject: isPlainObject}
  );
}
