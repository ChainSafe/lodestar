import sinon, {SinonStubbedInstance} from "sinon";
import {BeaconChain, ChainEvent, ChainEventEmitter, IBeaconChain} from "../../../src/chain";
import {BeaconReqRespHandler, IReqRespHandler} from "../../../src/sync/reqResp";
import {AttestationCollector} from "../../../src/sync/utils";
import {BeaconGossipHandler, IGossipHandler} from "../../../src/sync/gossip";
import {IRegularSync} from "../../../src/sync/regular";
import {getSyncProtocols, getUnknownRootProtocols, INetwork, Libp2pNetwork} from "../../../src/network";
import {ReqResp} from "../../../src/network/reqresp/reqResp";
import {FastSync, InitialSync} from "../../../src/sync/initial";
import {BeaconSync, SyncMode} from "../../../src/sync";
import {config} from "@chainsafe/lodestar-config/minimal";
import {expect} from "chai";
import {BeaconDb} from "../../../src/db/api";
import {generateEmptySignedBlock} from "../../utils/block";
import {ISyncOptions} from "../../../src/sync/options";
import {IBeaconSync} from "../../../src/sync";
import {silentLogger} from "../../utils/logger";
import {ForkChoice, IBlockSummary, IForkChoice} from "@chainsafe/lodestar-fork-choice";
import {WinstonLogger} from "@chainsafe/lodestar-utils";
import {ORARegularSync} from "../../../src/sync/regular/oneRangeAhead/oneRangeAhead";
import {BlockError, BlockErrorCode} from "../../../src/chain/errors";
import {BlockPool} from "../../../src/chain/blocks";
import PeerId from "peer-id";
import {Libp2pPeerMetadataStore, SimpleRpcScoreTracker} from "../../../src/network/peers";
import {Status} from "@chainsafe/lodestar-types";
import {fromHexString} from "@chainsafe/ssz";

describe("sync", function () {
  let chainStub: SinonStubbedInstance<IBeaconChain>;
  let forkChoiceStub: SinonStubbedInstance<IForkChoice>;
  let syncReqRespStub: SinonStubbedInstance<IReqRespHandler>;
  let attestationCollectorStub: SinonStubbedInstance<AttestationCollector>;
  let gossipStub: SinonStubbedInstance<IGossipHandler>;
  let networkStub: SinonStubbedInstance<INetwork>;
  let reqRespStub: SinonStubbedInstance<ReqResp>;
  let peerMetadataStoreStub: SinonStubbedInstance<Libp2pPeerMetadataStore>;
  let peerRpcScoresStub: SinonStubbedInstance<SimpleRpcScoreTracker>;
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
      reqRespHandler: syncReqRespStub,
      gossipHandler: gossipStub,
      attestationCollector: (attestationCollectorStub as unknown) as AttestationCollector,
      logger: silentLogger,
    });
  };

  beforeEach(function () {
    sandbox.useFakeTimers();
    chainStub = sandbox.createStubInstance(BeaconChain);
    chainStub.forkChoice = forkChoiceStub = sandbox.createStubInstance(ForkChoice);
    chainStub.emitter = new ChainEventEmitter();
    chainStub.pendingBlocks = new BlockPool({config});
    syncReqRespStub = sandbox.createStubInstance(BeaconReqRespHandler);
    attestationCollectorStub = sandbox.createStubInstance(AttestationCollector);
    gossipStub = sandbox.createStubInstance(BeaconGossipHandler);
    networkStub = sandbox.createStubInstance(Libp2pNetwork);
    reqRespStub = sandbox.createStubInstance(ReqResp);
    peerMetadataStoreStub = sandbox.createStubInstance(Libp2pPeerMetadataStore);
    peerRpcScoresStub = sandbox.createStubInstance(SimpleRpcScoreTracker);
    networkStub.peerMetadata = peerMetadataStoreStub;
    networkStub.reqResp = reqRespStub;
    networkStub.peerRpcScores = peerRpcScoresStub;
    initialSyncStub = sandbox.createStubInstance(FastSync);
    regularSync = new ORARegularSync(
      {},
      {
        config,
        network: networkStub,
        chain: chainStub,
        logger: new WinstonLogger(),
      }
    );
    sandbox.stub(regularSync, "start").resolves();
    sandbox.stub(regularSync, "stop").resolves();
  });

  afterEach(async () => {
    sandbox.restore();
  });

  describe("isSynced", () => {
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
  });

  describe("getSyncStatus", () => {
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

  describe("onUnknownBlockRoot", () => {
    it("should call beaconBlocksByRoot on PARENT_UNKNOWN error", async () => {
      const sync = getSync({minPeers: 0, maxSlotImport: 10, blockPerChunk: 10});
      forkChoiceStub.getHead.returns({slot: 0} as IBlockSummary);
      // to bypass initial sync
      networkStub.getPeers
        .withArgs({
          connected: true,
          supportsProtocols: getSyncProtocols(),
        })
        .returns([]);
      await sync.start();
      regularSync.emit("syncCompleted");
      expect(sync.isSynced()).to.be.true;
      const missingParentRoot = fromHexString("0x405c7819d21818eda7caeb07eff92bfdb6f356e6bcbf4ca31eaabe67ef6cecf2");
      const signedBlock = generateEmptySignedBlock();
      signedBlock.message.parentRoot = missingParentRoot;
      // for onUnknownBlockRoot
      const peerId = await PeerId.create();
      networkStub.getPeers
        .withArgs({
          connected: true,
          supportsProtocols: getUnknownRootProtocols(),
        })
        .returns([{id: peerId} as LibP2p.Peer]);
      // for logPeerCount
      networkStub.getPeers
        .withArgs({
          connected: true,
        })
        .returns([{id: peerId} as LibP2p.Peer]);
      peerMetadataStoreStub.getStatus.withArgs(peerId).returns({} as Status);
      peerRpcScoresStub.getScore.withArgs(peerId).returns(99);
      const blockError = new BlockError({
        code: BlockErrorCode.PARENT_UNKNOWN,
        parentRoot: missingParentRoot,
        job: {
          signedBlock: signedBlock,
          reprocess: false,
          prefinalized: false,
          validProposerSignature: false,
          validSignatures: false,
        },
      });
      chainStub.emitter.emit(ChainEvent.errorBlock, blockError);
      expect(
        reqRespStub.beaconBlocksByRoot.withArgs(peerId, sinon.match.any).calledOnce,
        "should call beaconBlocksByRoot to get unknown ancestor root"
      ).to.be.true;
      // issue event again, beaconBlocksByRoot is not called due to the cache
      chainStub.emitter.emit(ChainEvent.errorBlock, blockError);
      expect(
        reqRespStub.beaconBlocksByRoot.withArgs(peerId, sinon.match.any).calledOnce,
        "should not call duplicate beaconBlocksByRoot in less than 1 minute"
      ).to.be.true;
      // after 1 minute it should issue same beaconBlocksByRoot
      sandbox.clock.tick(60001);
      chainStub.emitter.emit(ChainEvent.errorBlock, blockError);
      expect(
        reqRespStub.beaconBlocksByRoot.withArgs(peerId, sinon.match.any).calledTwice,
        "should call beaconBlocksByRoot again after 1 minute"
      ).to.be.true;
    });
  });
});
