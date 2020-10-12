import sinon, {SinonStubbedInstance} from "sinon";
import {BeaconChain, ChainEventEmitter, IBeaconChain} from "../../../src/chain";
import {BeaconReqRespHandler, IReqRespHandler} from "../../../src/sync/reqResp";
import {AttestationCollector} from "../../../src/sync/utils";
import {BeaconGossipHandler, IGossipHandler} from "../../../src/sync/gossip";
import {INetwork, Libp2pNetwork} from "../../../src/network";
import {IRegularSync, NaiveRegularSync} from "../../../src/sync/regular";
import {FastSync, InitialSync} from "../../../src/sync/initial";
import {BeaconSync, SyncMode} from "../../../src/sync";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {expect} from "chai";
import {BeaconDb} from "../../../src/db/api";
import {generateEmptySignedBlock} from "../../utils/block";
import {ISyncOptions} from "../../../src/sync/options";
import {IBeaconSync} from "../../../src/sync";
import {silentLogger} from "../../utils/logger";
import {ForkChoice, IBlockSummary, IForkChoice} from "@chainsafe/lodestar-fork-choice";
import {WinstonLogger} from "@chainsafe/lodestar-utils";

describe("sync", function () {
  let chainStub: SinonStubbedInstance<IBeaconChain>;
  let forkChoiceStub: SinonStubbedInstance<IForkChoice>;
  let reqRespStub: SinonStubbedInstance<IReqRespHandler>;
  let attestationCollectorStub: SinonStubbedInstance<AttestationCollector>;
  let gossipStub: SinonStubbedInstance<IGossipHandler>;
  let networkStub: SinonStubbedInstance<INetwork>;
  let regularSync: IRegularSync;
  let initialSyncStub: SinonStubbedInstance<InitialSync>;
  const sandbox = sinon.createSandbox();

  const getSync = (opts: ISyncOptions): IBeaconSync => {
    return new BeaconSync(opts, {
      chain: chainStub,
      config,
      db: sandbox.createStubInstance(BeaconDb),
      regularSync: regularSync,
      initialSync: initialSyncStub,
      network: networkStub,
      reqRespHandler: reqRespStub,
      gossipHandler: gossipStub,
      attestationCollector: (attestationCollectorStub as unknown) as AttestationCollector,
      logger: silentLogger,
    });
  };

  beforeEach(function () {
    chainStub = sandbox.createStubInstance(BeaconChain);
    chainStub.forkChoice = forkChoiceStub = sandbox.createStubInstance(ForkChoice);
    chainStub.emitter = new ChainEventEmitter();
    reqRespStub = sandbox.createStubInstance(BeaconReqRespHandler);
    attestationCollectorStub = sandbox.createStubInstance(AttestationCollector);
    gossipStub = sandbox.createStubInstance(BeaconGossipHandler);
    networkStub = sandbox.createStubInstance(Libp2pNetwork);
    initialSyncStub = sandbox.createStubInstance(FastSync);
    regularSync = new NaiveRegularSync({}, {
      config,
      network: networkStub,
      chain: chainStub,
      logger: new WinstonLogger(),
    });
    sandbox.stub(regularSync, "start").resolves();
    sandbox.stub(regularSync, "stop").resolves();
  });

  afterEach(async () => {
    sandbox.restore();
  });

  it("not synced after start", async function () {
    const sync = getSync({minPeers: 0, maxSlotImport: 10, blockPerChunk: 10});
    forkChoiceStub.getHead.returns({slot: 0} as IBlockSummary);
    networkStub.getPeers.returns([]);
    await sync.start();
    expect(sync.isSynced()).to.be.false;
  });

  it("is synced after regular sync finishes", async function () {
    const sync = getSync({minPeers: 0, maxSlotImport: 10, blockPerChunk: 10});
    forkChoiceStub.getHead.returns({slot: 0} as IBlockSummary);
    networkStub.getPeers.returns([]);
    await sync.start();
    regularSync.emit("syncCompleted");
    expect(sync.isSynced()).to.be.true;
  });

  it("get sync status if synced", async function () {
    const sync = getSync({minPeers: 0, maxSlotImport: 10, blockPerChunk: 10});
    forkChoiceStub.getHead.returns({slot: 0} as IBlockSummary);
    networkStub.getPeers.returns([]);
    await sync.start();
    const status = await sync.getSyncStatus();
    expect(status.syncDistance.toString()).to.be.equal("0");
  });

  it("get sync status - regular sync", async function () {
    const sync = getSync({minPeers: 0, maxSlotImport: 10, blockPerChunk: 10});
    const block = generateEmptySignedBlock();
    block.message.slot = 10;
    forkChoiceStub.getHead.returns({slot: block.message.slot} as IBlockSummary);
    networkStub.getPeers.returns([]);
    await sync.start();
    // @ts-ignore
    sync.mode = SyncMode.REGULAR_SYNCING;
    sandbox.stub(regularSync, "getHighestBlock").resolves(15);
    const status = await sync.getSyncStatus();
    expect(status.headSlot.toString()).to.be.deep.equal("15");
    expect(status.syncDistance.toString()).to.be.deep.equal("5");
  });

  it("get sync status - initial sync", async function () {
    const sync = getSync({minPeers: 0, maxSlotImport: 10, blockPerChunk: 10});
    const block = generateEmptySignedBlock();
    block.message.slot = 10;
    forkChoiceStub.getHead.returns({slot: block.message.slot} as IBlockSummary);
    networkStub.getPeers.returns([]);
    await sync.start();
    // @ts-ignore
    sync.mode = SyncMode.INITIAL_SYNCING;
    initialSyncStub.getHighestBlock.resolves(15);
    const status = await sync.getSyncStatus();
    expect(status.headSlot.toString()).to.be.deep.equal("15");
    expect(status.syncDistance.toString()).to.be.deep.equal("5");
  });

  it("get sync status - initial sync - target less than our head", async function () {
    const sync = getSync({minPeers: 0, maxSlotImport: 10, blockPerChunk: 10});
    const block = generateEmptySignedBlock();
    block.message.slot = 10;
    forkChoiceStub.getHead.returns({slot: block.message.slot} as IBlockSummary);
    networkStub.getPeers.returns([]);
    await sync.start();
    // @ts-ignore
    sync.mode = SyncMode.INITIAL_SYNCING;
    initialSyncStub.getHighestBlock.resolves(5);
    const status = await sync.getSyncStatus();
    expect(status.headSlot.toString()).to.be.deep.equal("5");
    expect(status.syncDistance.toString()).to.be.deep.equal("0");
  });

  it("get sync status - waiting for peers", async function () {
    const sync = getSync({minPeers: 0, maxSlotImport: 10, blockPerChunk: 10});
    const block = generateEmptySignedBlock();
    block.message.slot = 10;
    forkChoiceStub.getHead.returns({slot: block.message.slot} as IBlockSummary);
    // @ts-ignore
    sync.mode = SyncMode.WAITING_PEERS;
    const status = await sync.getSyncStatus();
    expect(status.headSlot.toString()).to.be.deep.equal("0");
    expect(status.syncDistance.toString()).to.be.deep.equal("1");
  });
});
