import sinon from "sinon";
import {expect} from "chai";
import PeerInfo from "peer-info";
import PeerId from "peer-id";
import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";

import {BeaconChain} from "../../../src/chain";
import {Libp2pNetwork} from "../../../src/network";
import {ReputationStore} from "../../../src/sync/reputation";
import {WinstonLogger} from "../../../src/logger";
import {SyncRpc} from "../../../src/network/libp2p/syncRpc";
import {InitialSync} from "../../../src/sync/initial";
import {generateState} from "../../utils/state";
import {generateEmptyBlock} from "../../utils/block";
import {ChainRepository, StateRepository} from "../../../src/db/api/beacon/repositories";

describe("syncing", function () {
  let sandbox = sinon.createSandbox();
  let initialSync: InitialSync;
  let chainStub, rpcStub, networkStub, dbStub,
    repsStub, logger;

  beforeEach(() => {
    chainStub = sandbox.createStubInstance(BeaconChain);
    networkStub = sandbox.createStubInstance(Libp2pNetwork);
    dbStub = {
      chain: sandbox.createStubInstance(ChainRepository),
      state: sandbox.createStubInstance(StateRepository)
    };
    repsStub = sandbox.createStubInstance(ReputationStore);
    rpcStub = sandbox.createStubInstance(SyncRpc);
    logger = new WinstonLogger();
    logger.silent = true;

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
    logger.silent = false;
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
    dbStub.chain.setLatestStateRoot.resolves(0);
    dbStub.chain.setFinalizedStateRoot.resolves(0);
    dbStub.chain.setJustifiedStateRoot.resolves(0);
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
    dbStub.chain.setLatestStateRoot.resolves(0);
    dbStub.chain.setFinalizedStateRoot.resolves(0);
    dbStub.chain.setJustifiedStateRoot.resolves(0);
    rpcStub.getBeaconBlocks.resolves([generateEmptyBlock()]);
    chainStub.receiveBlock.resolves(0);

    try {
      await initialSync.syncToPeers();
    }catch (e) {
      expect.fail(e.stack);
    }

  });

});
