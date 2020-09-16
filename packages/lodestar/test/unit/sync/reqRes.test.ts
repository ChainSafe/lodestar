import {expect} from "chai";
import sinon, {SinonStubbedInstance} from "sinon";
import PeerId from "peer-id";

import {
  BeaconBlocksByRangeRequest,
  BeaconState,
  Goodbye,
  ResponseBody,
  SignedBeaconBlock,
  Status,
} from "@chainsafe/lodestar-types";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {computeStartSlotAtEpoch} from "@chainsafe/lodestar-beacon-state-transition";
import {ForkChoice} from "@chainsafe/lodestar-fork-choice";

import {BeaconChain} from "../../../src/chain";
import {GENESIS_EPOCH, Method, ZERO_HASH} from "../../../src/constants";
import {IBeaconDb} from "../../../src/db/api";
import {Libp2pNetwork} from "../../../src/network";
import {ReqResp} from "../../../src/network/reqResp";
import {IPeerMetadataStore} from "../../../src/network/peers/interface";
import {Libp2pPeerMetadataStore} from "../../../src/network/peers/metastore";
import {BeaconReqRespHandler} from "../../../src/sync/reqResp";
import {generateEmptySignedBlock} from "../../utils/block";
import {getBlockSummary} from "../../utils/headBlockInfo";
import {silentLogger} from "../../utils/logger";
import {generatePeer} from "../../utils/peer";
import {generateState} from "../../utils/state";
import {StubbedBeaconDb} from "../../utils/stub";

describe("sync req resp", function () {
  const logger = silentLogger;
  const sandbox = sinon.createSandbox();
  let syncRpc: BeaconReqRespHandler;
  let chainStub: SinonStubbedInstance<BeaconChain>,
    networkStub: SinonStubbedInstance<Libp2pNetwork>,
    metaStub: SinonStubbedInstance<IPeerMetadataStore>,
    forkChoiceStub: SinonStubbedInstance<ForkChoice> & ForkChoice,
    reqRespStub: SinonStubbedInstance<ReqResp>;
  let dbStub: StubbedBeaconDb;

  beforeEach(() => {
    chainStub = sandbox.createStubInstance(BeaconChain);
    forkChoiceStub = sandbox.createStubInstance(ForkChoice) as SinonStubbedInstance<ForkChoice> & ForkChoice;
    chainStub.forkChoice = forkChoiceStub;
    forkChoiceStub.getHead.returns(getBlockSummary({}));
    forkChoiceStub.getFinalizedCheckpoint.returns({epoch: GENESIS_EPOCH, root: ZERO_HASH});
    chainStub.getHeadState.resolves(generateState());
    // @ts-ignore
    chainStub.config = config;
    sandbox.stub(chainStub, "currentForkDigest").get(() => Buffer.alloc(4));
    reqRespStub = sandbox.createStubInstance(ReqResp);
    networkStub = sandbox.createStubInstance(Libp2pNetwork);
    networkStub.reqResp = (reqRespStub as unknown) as ReqResp & SinonStubbedInstance<ReqResp>;
    metaStub = sandbox.createStubInstance(Libp2pPeerMetadataStore);
    networkStub.peerMetadata = metaStub;
    dbStub = new StubbedBeaconDb(sandbox);

    syncRpc = new BeaconReqRespHandler({
      config,
      db: (dbStub as unknown) as IBeaconDb,
      chain: chainStub,
      network: networkStub,
      logger,
    });
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should start and stop sync rpc", async function () {
    const peerId = new PeerId(Buffer.from("lodestar"));
    networkStub.hasPeer.returns(true);
    networkStub.getPeers.returns([generatePeer(peerId), generatePeer(peerId)]);

    try {
      await syncRpc.start();
      await syncRpc.stop();
    } catch (e) {
      expect.fail(e.stack);
    }
  });

  it("should handle request  - onStatus(success)", async function () {
    const peerId = new PeerId(Buffer.from("lodestar"));
    const body: Status = {
      forkDigest: Buffer.alloc(4),
      finalizedRoot: Buffer.alloc(32),
      finalizedEpoch: 1,
      headRoot: Buffer.alloc(32),
      headSlot: 1,
    };
    reqRespStub.sendResponse.resolves(0);
    dbStub.stateCache.get.resolves(generateState() as any);
    try {
      await syncRpc.onRequest(peerId, Method.Status, "status", body);
      expect(reqRespStub.sendResponse.calledOnce).to.be.true;
      expect(reqRespStub.goodbye.called).to.be.false;
    } catch (e) {
      expect.fail(e.stack);
    }
  });

  it("should handle request  - onStatus(error)", async function () {
    const peerId = new PeerId(Buffer.from("lodestar"));
    const body: Status = {
      forkDigest: Buffer.alloc(4),
      finalizedRoot: Buffer.alloc(32),
      finalizedEpoch: 1,
      headRoot: Buffer.alloc(32),
      headSlot: 1,
    };
    try {
      reqRespStub.sendResponse.throws(new Error("server error"));
      await syncRpc.onRequest(peerId, Method.Status, "status", body);
    } catch (e) {
      expect(reqRespStub.sendResponse.called).to.be.true;
    }
  });

  it("should disconnect on status - incorrect headForkVersion", async function () {
    const body: Status = {
      forkDigest: Buffer.alloc(4),
      finalizedRoot: Buffer.alloc(32),
      finalizedEpoch: 1,
      headRoot: Buffer.alloc(32),
      headSlot: 1,
    };

    sandbox.stub(chainStub, "currentForkDigest").get(() => Buffer.alloc(4).fill(1));
    expect(await syncRpc.shouldDisconnectOnStatus(body)).to.be.true;
  });

  it("should not disconnect on status - too old finalized epoch", async function () {
    const body: Status = {
      forkDigest: Buffer.alloc(4),
      finalizedRoot: Buffer.alloc(32),
      finalizedEpoch: 1,
      headRoot: Buffer.alloc(32),
      headSlot: 1,
    };

    sandbox.stub(chainStub, "currentForkDigest").get(() => body.forkDigest);
    chainStub.getHeadState.resolves(
      generateState({
        slot: computeStartSlotAtEpoch(
          config,
          config.params.SLOTS_PER_HISTORICAL_ROOT / config.params.SLOTS_PER_EPOCH + 2
        ),
      })
    );
    forkChoiceStub.getHead.returns({
      finalizedEpoch: config.params.SLOTS_PER_HISTORICAL_ROOT / config.params.SLOTS_PER_EPOCH + 2,
      justifiedEpoch: 0,
      blockRoot: Buffer.alloc(32),
      parentRoot: Buffer.alloc(32),
      stateRoot: Buffer.alloc(32),
      targetRoot: Buffer.alloc(32),
      slot: computeStartSlotAtEpoch(
        config,
        config.params.SLOTS_PER_HISTORICAL_ROOT / config.params.SLOTS_PER_EPOCH + 2
      ),
    });
    expect(await syncRpc.shouldDisconnectOnStatus(body)).to.be.false;
  });

  it("should not disconnect on status", async function () {
    const body: Status = {
      forkDigest: Buffer.alloc(4),
      finalizedRoot: config.types.BeaconBlock.hashTreeRoot(generateEmptySignedBlock().message),
      finalizedEpoch: 1,
      headRoot: Buffer.alloc(32),
      headSlot: 1,
    };

    dbStub.blockArchive.get.resolves(generateEmptySignedBlock());
    const state: BeaconState = generateState();
    state.fork.currentVersion = Buffer.alloc(4);
    state.finalizedCheckpoint.epoch = 1;
    dbStub.stateCache.get.resolves(state as any);

    expect(await syncRpc.shouldDisconnectOnStatus(body)).to.be.false;
  });

  it("should handle request - onGoodbye", async function () {
    const peerId = new PeerId(Buffer.from("lodestar"));
    const goodbye: Goodbye = BigInt(1);
    networkStub.disconnect.resolves();
    try {
      await syncRpc.onRequest(peerId, Method.Goodbye, "goodBye", goodbye);
      // expect(networkStub.disconnect.calledOnce).to.be.true;
    } catch (e) {
      expect.fail(e.stack);
    }
  });

  it("should fail to handle request ", async function () {
    const peerId = new PeerId(Buffer.from("lodestar"));
    try {
      await syncRpc.onRequest(peerId, null!, "null", null!);
    } catch (e) {
      expect.fail(e.stack);
    }
  });

  it("should handle request - onBeaconBlocksByRange", async function () {
    const peerId = new PeerId(Buffer.from("lodestar"));
    const body: BeaconBlocksByRangeRequest = {
      startSlot: 2,
      count: 4,
      step: 2,
    };
    dbStub.blockArchive.valuesStream.returns(
      (async function* () {
        for (const slot of [2, 4]) {
          const block = generateEmptySignedBlock();
          block.message.slot = slot;
          yield block;
        }
      })()
    );
    const block8 = generateEmptySignedBlock();
    block8.message.slot = 8;
    // block 6 does not exist
    chainStub.getUnfinalizedBlocksAtSlots.resolves([null!, block8]);
    let blockStream: AsyncIterable<ResponseBody>;
    reqRespStub.sendResponseStream.callsFake((id, err, chunkIter) => {
      blockStream = chunkIter;
    });
    await syncRpc.onRequest(peerId, Method.BeaconBlocksByRange, "range", body);
    const slots: number[] = [];
    for await (const body of blockStream!) {
      slots.push((body as SignedBeaconBlock).message.slot);
    }
    // count is 4 but it returns only 3 blocks because block 6 does not exist
    expect(slots).to.be.deep.equal([2, 4, 8]);
  });
});
