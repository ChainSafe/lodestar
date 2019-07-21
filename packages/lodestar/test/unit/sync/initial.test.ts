import sinon from "sinon";
import {expect} from  "chai";
import {BeaconChain} from "../../../src/chain";
import {Libp2pNetwork} from "../../../src/network";
import {BeaconDB} from "../../../src/db/api";
import {ReputationStore} from "../../../src/sync/reputation";
import {WinstonLogger} from "../../../src/logger";
import {SyncRpc} from "../../../src/sync/rpc";
import {InitialSync} from "../../../src/sync/initial";
import {generateState} from "../../utils/state";
import PeerInfo from "peer-info";
import PeerId from "peer-id";
import {config} from "../../../src/config/presets/mainnet";
import {generateEmptyBlock} from "../../utils/block";

describe("syncing", function () {
  let sandbox = sinon.createSandbox();
  let initialSync: InitialSync;
  let chainStub, rpcStub, networkStub, dbStub,
    repsStub, logger;

  beforeEach(() => {
    chainStub = sandbox.createStubInstance(BeaconChain);
    networkStub = sandbox.createStubInstance(Libp2pNetwork);
    dbStub = sandbox.createStubInstance(BeaconDB);
    repsStub = sandbox.createStubInstance(ReputationStore);
    rpcStub = sandbox.createStubInstance(SyncRpc);
    logger = new WinstonLogger();
    logger.silent(true);

    initialSync = new InitialSync({}, {
      config,
      db: dbStub,
      chain: chainStub,
      rpc: rpcStub,
      network: networkStub,
      reps: repsStub,
      logger: logger,
    }
    );
  });

  afterEach(() => {
    sandbox.restore();
    logger.silent(false);
  });


  it('should fail to sync - invalid states length ', async function () {

    repsStub.get.returns({
      latestHello: {
        latestFinalizedRoot: null,
      }
    });
    rpcStub.getBeaconStates.resolves([]);

    let peerInfo: PeerInfo = new PeerInfo(new PeerId(Buffer.alloc(32)));
    try {
      await initialSync.syncToPeer(peerInfo);
      expect.fail();
    }catch (e) {
      expect(repsStub.get.calledOnce).to.be.true;
      expect(rpcStub.getBeaconStates.calledOnce).to.be.true;
    }
  });


  it('should able to sync to peer', async function () {

    repsStub.get.returns({
      latestHello: {
        latestFinalizedRoot: null,
      }
    });
    rpcStub.getBeaconStates.resolves([generateState()]);

    let peerInfo: PeerInfo = new PeerInfo(new PeerId(Buffer.alloc(32)));
    dbStub.setLatestStateRoot.resolves(0);
    dbStub.setFinalizedStateRoot.resolves(0);
    dbStub.setJustifiedStateRoot.resolves(0);
    rpcStub.getBeaconBlocks.resolves([generateEmptyBlock()]);
    chainStub.receiveBlock.resolves(0);

    await initialSync.syncToPeer(peerInfo);
    expect(chainStub.receiveBlock.calledOnce).to.be.true;

  });

  it('should process sync to peers', async function () {

    repsStub.get.returns({
      latestHello: {
        latestFinalizedRoot: null,
      }
    });
    rpcStub.getBeaconStates.resolves([generateState()]);

    let peerInfo: PeerInfo = new PeerInfo(new PeerId(Buffer.alloc(32)));
    networkStub.getPeers.returns([peerInfo, peerInfo]);
    dbStub.setLatestStateRoot.resolves(0);
    dbStub.setFinalizedStateRoot.resolves(0);
    dbStub.setJustifiedStateRoot.resolves(0);
    rpcStub.getBeaconBlocks.resolves([generateEmptyBlock()]);
    chainStub.receiveBlock.resolves(0);

    try {
      await initialSync.syncToPeers();
    }catch (e) {
      expect.fail(e.stack);
    }

  });

});
