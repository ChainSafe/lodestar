import sinon from "sinon";
import {expect} from "chai";
import PeerInfo from "peer-info";
import PeerId from "peer-id";
import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";

import {BeaconChain} from "../../../src/chain";
import {Libp2pNetwork} from "../../../src/network";
import {ReputationStore} from "../../../src/sync/reputation";
import {WinstonLogger} from "../../../src/logger";
import {InitialSync} from "../../../src/sync/initial";
import {generateState} from "../../utils/state";
import {generateEmptyBlock} from "../../utils/block";
import {ChainRepository, StateRepository} from "../../../src/db/api/beacon/repositories";
import {ReqResp} from "../../../src/network/reqResp";

describe("syncing", function () {
  let sandbox = sinon.createSandbox();
  let initialSync: InitialSync;
  let chainStub, rpcStub, networkStub, reqRespStub, dbStub,
    repsStub, logger;

  beforeEach(() => {
    chainStub = sandbox.createStubInstance(BeaconChain);
    chainStub.latestState = generateState();
    reqRespStub = sandbox.createStubInstance(ReqResp);
    networkStub = sandbox.createStubInstance(Libp2pNetwork);
    networkStub.reqResp = reqRespStub;
    dbStub = {
      chain: sandbox.createStubInstance(ChainRepository),
      state: sandbox.createStubInstance(StateRepository)
    };
    repsStub = sandbox.createStubInstance(ReputationStore);
    logger = new WinstonLogger();
    logger.silent = true;

    initialSync = new InitialSync({}, {
      config,
      db: dbStub,
      chain: chainStub,
      network: networkStub,
      reps: repsStub,
      logger: logger,
    });
  });

  afterEach(() => {
    sandbox.restore();
    logger.silent = false;
  });

  it('should able to sync to peer', async function () {

    repsStub.get.returns({
      latestHello: {
        finalizedRoot: null,
      }
    });

    let peerInfo: PeerInfo = new PeerInfo(new PeerId(Buffer.alloc(32)));
    dbStub.chain.setLatestStateRoot.resolves(0);
    dbStub.chain.setFinalizedStateRoot.resolves(0);
    dbStub.chain.setJustifiedStateRoot.resolves(0);
    reqRespStub.beaconBlocks.resolves({blocks: [generateEmptyBlock()]});
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

    let peerInfo: PeerInfo = new PeerInfo(new PeerId(Buffer.alloc(32)));
    networkStub.getPeers.returns([peerInfo, peerInfo]);
    dbStub.chain.setLatestStateRoot.resolves(0);
    dbStub.chain.setFinalizedStateRoot.resolves(0);
    dbStub.chain.setJustifiedStateRoot.resolves(0);
    reqRespStub.beaconBlocks.resolves({blocks: [generateEmptyBlock()]});
    chainStub.receiveBlock.resolves(0);

    try {
      await initialSync.syncToPeers();
    }catch (e) {
      expect.fail(e.stack);
    }

  });

});
