import {expect} from "chai";
import sinon, {SinonStub, SinonStubbedInstance} from "sinon";

import {Checkpoint} from "@chainsafe/lodestar-types";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {ForkChoice} from "@chainsafe/lodestar-fork-choice";

import {BeaconChain, ChainEventEmitter, IBeaconChain} from "../../../../src/chain";
import {INetwork, Libp2pNetwork} from "../../../../src/network";
import {IPeerMetadataStore} from "../../../../src/network/peers/interface";
import {Libp2pPeerMetadataStore} from "../../../../src/network/peers/metastore";
import {FastSync} from "../../../../src/sync/initial/fast";
import * as syncUtils from "../../../../src/sync/utils";
import {SyncStats} from "../../../../src/sync/stats";
import {StubbedBeaconDb} from "../../../utils/stub";
import {generateEmptySignedBlock} from "../../../utils/block";
import {silentLogger} from "../../../utils/logger";

describe("fast sync", function () {
  const sandbox = sinon.createSandbox();

  const logger = silentLogger;
  let chainStub: SinonStubbedInstance<IBeaconChain>;
  let forkChoiceStub: SinonStubbedInstance<ForkChoice>;
  let networkStub: SinonStubbedInstance<INetwork>;
  let metaStub: SinonStubbedInstance<IPeerMetadataStore>;
  let getTargetStub: SinonStub;
  let dbStub: StubbedBeaconDb;

  beforeEach(function () {
    forkChoiceStub = sinon.createStubInstance(ForkChoice);
    chainStub = sinon.createStubInstance(BeaconChain);
    chainStub.forkChoice = forkChoiceStub;
    chainStub.emitter = new ChainEventEmitter();
    networkStub = sinon.createStubInstance(Libp2pNetwork);
    metaStub = sinon.createStubInstance(Libp2pPeerMetadataStore);
    networkStub.peerMetadata = metaStub;
    getTargetStub = sandbox.stub(syncUtils, "getCommonFinalizedCheckpoint");
    dbStub = new StubbedBeaconDb(sinon);
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("no peers with finalized epoch", async function () {
    dbStub.blockArchive.lastValue.resolves(generateEmptySignedBlock());
    const sync = new FastSync(
      {blockPerChunk: 5, maxSlotImport: 10, minPeers: 0},
      {
        config,
        chain: chainStub,
        logger,
        network: networkStub,
        stats: sinon.createStubInstance(SyncStats),
        db: dbStub,
      }
    );
    getTargetStub.returns({
      epoch: 0,
    });
    networkStub.getPeers.returns([]);
    await sync.start();
  });

  //TODO: make sync abortable (test hangs on sleeping 6s when waiting for peers)
  it.skip("should sync till target and end", function (done) {
    dbStub.blockArchive.lastValue.resolves(generateEmptySignedBlock());
    const statsStub = sinon.createStubInstance(SyncStats);
    statsStub.start.resolves();
    statsStub.getEstimate.returns(1);
    statsStub.getSyncSpeed.returns(1);
    const sync = new FastSync(
      {blockPerChunk: 5, maxSlotImport: 10, minPeers: 0},
      {
        config,
        //@ts-ignore
        chain: chainStub,
        logger,
        network: networkStub,
        stats: statsStub,
        db: dbStub,
      }
    );
    const target: Checkpoint = {
      epoch: 2,
      root: Buffer.alloc(32, 1),
    };
    getTargetStub.returns(target);
    networkStub.getPeers.returns([]);
    const endCallbackStub = sinon.stub(chainStub.emitter, "removeListener");
    endCallbackStub.withArgs("checkpoint" as any, sinon.match.any).callsFake(() => {
      expect(getTargetStub.calledTwice).to.be.true;
      endCallbackStub.restore();
      done();
    });
    sync.start();
    chainStub.emitter.emit("checkpoint", {epoch: 1, root: Buffer.alloc(32)} as Checkpoint, {} as any);
    chainStub.emitter.emit("checkpoint", target, {} as any);
  });

  //TODO: make sync abortable (test hangs on sleeping 6s when waiting for peers)
  it.skip("should continue syncing if there is new target", function (done) {
    dbStub.blockArchive.lastValue.resolves(generateEmptySignedBlock());
    const statsStub = sinon.createStubInstance(SyncStats);
    statsStub.start.resolves();
    statsStub.getEstimate.returns(1);
    statsStub.getSyncSpeed.returns(1);
    const sync = new FastSync(
      {blockPerChunk: 5, maxSlotImport: 10, minPeers: 0},
      {
        config,
        //@ts-ignore
        chain: chainStub,
        logger,
        network: networkStub,
        stats: statsStub,
        db: dbStub,
      }
    );
    const target1: Checkpoint = {
      epoch: 2,
      root: Buffer.alloc(32, 1),
    };
    const target2: Checkpoint = {
      epoch: 4,
      root: Buffer.alloc(32, 1),
    };
    getTargetStub.onFirstCall().returns(target1).onSecondCall().returns(target2).onThirdCall().returns(target2);
    networkStub.getPeers.returns([]);
    const endCallbackStub = sinon.stub(chainStub.emitter, "removeListener");
    endCallbackStub.withArgs("checkpoint" as any, sinon.match.any).callsFake(() => {
      expect(getTargetStub.calledThrice).to.be.true;
      endCallbackStub.restore();
      done();
    });
    sync.start();
    chainStub.emitter.emit("checkpoint", target1, {} as any);
    chainStub.emitter.emit("checkpoint", target2, {} as any);
  });
});
