import sinon, {SinonStubbedInstance} from "sinon";
import {BeaconChain, IBeaconChain} from "../../../src/chain";
import {BeaconReqRespHandler, IReqRespHandler} from "../../../src/sync/reqResp";
import {AttestationCollector} from "../../../src/sync/utils";
import {BeaconGossipHandler, IGossipHandler} from "../../../src/sync/gossip";
import {INetwork, Libp2pNetwork} from "../../../src/network";
import {ILogger, WinstonLogger} from "@chainsafe/lodestar-utils/lib/logger";
import {IRegularSync, NaiveRegularSync} from "../../../src/sync/regular";
import {FastSync, InitialSync} from "../../../src/sync/initial";
import {BeaconSync, SyncMode} from "../../../src/sync";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {expect} from "chai";
import {BeaconDb} from "../../../src/db/api";
import {ReputationStore} from "../../../src/sync/IReputation";
import {generateEmptySignedBlock} from "../../utils/block";
import {ISyncOptions} from "../../../src/sync/options";
import {IBeaconSync} from "../../../lib/sync";

describe("sync", function () {

  let chainStub: SinonStubbedInstance<IBeaconChain>;
  let reqRespStub: SinonStubbedInstance<IReqRespHandler>;
  let attestationCollectorStub: SinonStubbedInstance<AttestationCollector>;
  let gossipStub: SinonStubbedInstance<IGossipHandler>;
  let networkStub: SinonStubbedInstance<INetwork>;
  let loggerStub: SinonStubbedInstance<ILogger>;
  let regularSyncStub: SinonStubbedInstance<IRegularSync>;
  let initialSyncStub: SinonStubbedInstance<InitialSync>;

  const getSync = (opts: ISyncOptions): IBeaconSync => {
    return new BeaconSync(
      opts,
      {
        chain: chainStub,
        config,
        db: sinon.createStubInstance(BeaconDb),
        regularSync: regularSyncStub,
        initialSync: initialSyncStub,
        network: networkStub,
        reqRespHandler: reqRespStub,
        gossipHandler: gossipStub,
        reputationStore: sinon.createStubInstance(ReputationStore),
        attestationCollector: attestationCollectorStub as unknown as AttestationCollector,
        logger: loggerStub,
      });
  };

  beforeEach(function () {
    chainStub = sinon.createStubInstance(BeaconChain);
    reqRespStub = sinon.createStubInstance(BeaconReqRespHandler);
    attestationCollectorStub = sinon.createStubInstance(AttestationCollector);
    gossipStub = sinon.createStubInstance(BeaconGossipHandler);
    networkStub = sinon.createStubInstance(Libp2pNetwork);
    loggerStub = sinon.createStubInstance(WinstonLogger);
    regularSyncStub = sinon.createStubInstance(NaiveRegularSync);
    initialSyncStub = sinon.createStubInstance(FastSync);
  });

  it("is synced should be true", async function () {
    const sync = getSync({minPeers: 0, maxSlotImport: 10, blockPerChunk: 10});
    chainStub.getHeadBlock.resolves(generateEmptySignedBlock());
    networkStub.getPeers.returns([]);
    await sync.start();
    expect(sync.isSynced()).to.be.true;
  });

  it("is synced should be false", async function () {
    const sync = getSync({minPeers: 1, maxSlotImport: 10, blockPerChunk: 10});
    chainStub.getHeadBlock.resolves(generateEmptySignedBlock());
    networkStub.getPeers.returns([]);
    sync.start();
    expect(sync.isSynced()).to.be.false;
    await sync.stop();
  });

  it("get sync status if synced", async function () {
    const sync = getSync({minPeers: 0, maxSlotImport: 10, blockPerChunk: 10});
    chainStub.getHeadBlock.resolves(generateEmptySignedBlock());
    networkStub.getPeers.returns([]);
    await sync.start();
    const status = await sync.getSyncStatus();
    expect(status.syncDistance.toString()).to.be.equal("0");
  });

  it("get sync status - regular sync", async function () {
    const sync = getSync({minPeers: 0, maxSlotImport: 10, blockPerChunk: 10});
    const block = generateEmptySignedBlock();
    block.message.slot = 10;
    chainStub.getHeadBlock.onFirstCall().resolves(generateEmptySignedBlock()).onSecondCall().resolves(block);
    networkStub.getPeers.returns([]);
    await sync.start();
    // @ts-ignore
    sync.mode = SyncMode.REGULAR_SYNCING;
    regularSyncStub.getHighestBlock.resolves(15);
    const status = await sync.getSyncStatus();
    expect(status.headSlot.toString()).to.be.deep.equal("15");
    expect(status.syncDistance.toString()).to.be.deep.equal("5");
  });

  it("get sync status - initial sync", async function () {
    const sync = getSync({minPeers: 0, maxSlotImport: 10, blockPerChunk: 10});
    const block = generateEmptySignedBlock();
    block.message.slot = 10;
    chainStub.getHeadBlock.onFirstCall().resolves(generateEmptySignedBlock()).onSecondCall().resolves(block);
    networkStub.getPeers.returns([]);
    await sync.start();
    // @ts-ignore
    sync.mode = SyncMode.INITIAL_SYNCING;
    initialSyncStub.getHighestBlock.resolves(15);
    const status = await sync.getSyncStatus();
    expect(status.headSlot.toString()).to.be.deep.equal("15");
    expect(status.syncDistance.toString()).to.be.deep.equal("5");
  });

});
