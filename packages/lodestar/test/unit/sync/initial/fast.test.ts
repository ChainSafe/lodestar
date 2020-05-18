import {describe} from "mocha";
import sinon, {SinonStub, SinonStubbedInstance} from "sinon";
import {FastSync} from "../../../../src/sync/initial/fast";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {BeaconChain, IBeaconChain, ILMDGHOST, StatefulDagLMDGHOST} from "../../../../src/chain";
import {WinstonLogger} from "@chainsafe/lodestar-utils/lib/logger";
import {INetwork, Libp2pNetwork} from "../../../../src/network";
import {ReputationStore} from "../../../../src/sync/IReputation";
import * as syncUtils from "../../../../src/sync/utils";
import {Checkpoint} from "@chainsafe/lodestar-types";
import {EventEmitter} from "events";
import {expect} from "chai";
import {SyncStats} from "../../../../src/sync/stats";

describe("fast sync", function () {

  const sandbox = sinon.createSandbox();

  let chainStub: SinonStubbedInstance<IBeaconChain>;
  let forkChoiceStub: SinonStubbedInstance<ILMDGHOST>;
  let networkStub: SinonStubbedInstance<INetwork>;
  let repsStub: SinonStubbedInstance<ReputationStore>;
  let getTargetStub: SinonStub;
  let targetSlotToBlockChunksStub: SinonStub;

  beforeEach(function () {
    forkChoiceStub = sinon.createStubInstance(StatefulDagLMDGHOST);
    chainStub = sinon.createStubInstance(BeaconChain);
    chainStub.forkChoice = forkChoiceStub;
    networkStub = sinon.createStubInstance(Libp2pNetwork);
    repsStub = sinon.createStubInstance(ReputationStore);
    getTargetStub = sandbox.stub(syncUtils, "getCommonFinalizedCheckpoint");
    targetSlotToBlockChunksStub = sandbox.stub(syncUtils, "targetSlotToBlockChunks");
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("no peers with finalized epoch", async function () {
    forkChoiceStub.headBlockSlot.returns(0);
    const sync = new FastSync(
      {blockPerChunk: 5, maxSlotImport: 10, minPeers: 0},
      {
        config,
        chain: chainStub,
        logger: sinon.createStubInstance(WinstonLogger),
        network: networkStub,
        stats: sinon.createStubInstance(SyncStats),
        reputationStore: repsStub
      }
    );
    getTargetStub.returns({
      epoch: 0
    });
    networkStub.getPeers.returns([]);
    await sync.start();
  });

  it("should sync till target and end", function (done) {
    const chainEventEmitter = new EventEmitter();
    const forkChoiceStub = sinon.createStubInstance(StatefulDagLMDGHOST);
    forkChoiceStub.headBlockSlot.returns(0);
    // @ts-ignore
    chainEventEmitter.forkChoice = forkChoiceStub;
    const statsStub = sinon.createStubInstance(SyncStats);
    statsStub.start.resolves();
    statsStub.getEstimate.returns(1);
    statsStub.getSyncSpeed.returns(1);
    const sync = new FastSync(
      {blockPerChunk: 5, maxSlotImport: 10, minPeers: 0},
      {
        config,
        //@ts-ignore
        chain: chainEventEmitter,
        logger: sinon.createStubInstance(WinstonLogger),
        network: networkStub,
        stats: statsStub,
        reputationStore: repsStub
      }
    );
    const target: Checkpoint = {
      epoch: 2,
      root: Buffer.alloc(32, 1)
    };
    getTargetStub.returns(target);
    networkStub.getPeers.returns([]);
    targetSlotToBlockChunksStub.returns((source: any) => {
      return (async function* () {
        for await (const data of source) {
          if(data === 0) yield data;
        }
      })();
    });
    const endCallbackStub = sinon.stub(chainEventEmitter, "removeListener");
    // @ts-ignore
    endCallbackStub.withArgs("processedCheckpoint", sinon.match.any).callsFake(() => {
      expect(getTargetStub.calledTwice).to.be.true;
      done();
      return this;
    });
    sync.start();
    chainEventEmitter.emit("processedCheckpoint", {epoch: 1, root: Buffer.alloc(32)} as Checkpoint);
    chainEventEmitter.emit("processedCheckpoint", target);
  });

  it("should continue syncing if there is new target", function (done) {
    const chainEventEmitter = new EventEmitter();
    const forkChoiceStub = sinon.createStubInstance(StatefulDagLMDGHOST);
    forkChoiceStub.headBlockSlot.returns(0);
    // @ts-ignore
    chainEventEmitter.forkChoice = forkChoiceStub;
    const statsStub = sinon.createStubInstance(SyncStats);
    statsStub.start.resolves();
    statsStub.getEstimate.returns(1);
    statsStub.getSyncSpeed.returns(1);
    const sync = new FastSync(
      {blockPerChunk: 5, maxSlotImport: 10, minPeers: 0},
      {
        config,
        //@ts-ignore
        chain: chainEventEmitter,
        logger: sinon.createStubInstance(WinstonLogger),
        network: networkStub,
        stats: statsStub,
        reputationStore: repsStub
      }
    );
    const target1: Checkpoint = {
      epoch: 2,
      root: Buffer.alloc(32, 1)
    };
    const target2: Checkpoint = {
      epoch: 4,
      root: Buffer.alloc(32, 1)
    };
    getTargetStub.onFirstCall().returns(target1).onSecondCall().returns(target2).onThirdCall().returns(target2);
    networkStub.getPeers.returns([]);
    targetSlotToBlockChunksStub.returns((source: any) => {
      return (async function* () {
        for await (const data of source) {
          if(data === 0) yield data;
        }
      })();
    });
    const endCallbackStub = sinon.stub(chainEventEmitter, "removeListener");
    // @ts-ignore
    endCallbackStub.withArgs("processedCheckpoint", sinon.match.any).callsFake(() => {
      expect(getTargetStub.calledThrice).to.be.true;
      done();
      return this;
    });
    sync.start();
    chainEventEmitter.emit("processedCheckpoint", target1);
    chainEventEmitter.emit("processedCheckpoint", target2);
  });

});
