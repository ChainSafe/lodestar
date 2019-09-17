import sinon from "sinon";
import {expect} from  "chai";
import PeerId from "peer-id";
import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";

import {BeaconChain} from "../../../src/chain";
import {Libp2pNetwork} from "../../../src/network";
import {OpPool} from "../../../src/opPool";
import {EthersEth1Notifier} from "../../../src/eth1";
import {ReputationStore} from "../../../src/sync/reputation";
import {WinstonLogger} from "../../../src/logger";
import {RegularSync} from "../../../src/sync/regular";
import {Sync} from "../../../src/sync";
import {ChainRepository, StateRepository} from "../../../src/db/api/beacon/repositories";
import {ReqResp} from "../../../src/network/reqResp";

describe("syncing", function () {
  let sandbox = sinon.createSandbox();
  let sync: Sync;
  let chainStub, networkStub, opPoolStub, eth1Stub, dbStub,
    repsStub, logger, syncerStub;

  beforeEach(() => {
    chainStub = sandbox.createStubInstance(BeaconChain);
    networkStub = sandbox.createStubInstance(Libp2pNetwork);
    networkStub.reqResp = sandbox.createStubInstance(ReqResp);
    opPoolStub = sandbox.createStubInstance(OpPool);
    eth1Stub = sandbox.createStubInstance(EthersEth1Notifier);
    dbStub = {
      chain: sandbox.createStubInstance(ChainRepository),
      state: sandbox.createStubInstance(StateRepository)
    };
    repsStub = sandbox.createStubInstance(ReputationStore);
    logger = new WinstonLogger();
    syncerStub = sandbox.createStubInstance(RegularSync);
    logger.silent = true;


    sync = new Sync({}, {
      config,
      chain: chainStub,
      db: dbStub,
      eth1: eth1Stub,
      network: networkStub,
      opPool: opPoolStub,
      reps: repsStub,
      logger,
    });
  });

  afterEach(() => {
    sandbox.restore();
    logger.silent = false;
  });


  it('should return true - chain synced ', async function () {

    //first case
    chainStub.isInitialized.resolves(false);
    let result = await sync.isSynced();
    expect(result).to.be.deep.equal(true);

    //2nd case
    chainStub.isInitialized.resolves(true);
    dbStub.chain.getChainHeadSlot.resolves(10);
    repsStub.get.returns({
      latestHello: {
        headSlot: 5
      },
    });

    let peerId: PeerId = new PeerId(Buffer.alloc(32));

    networkStub.getPeers.returns([
      {
        id: peerId,
      },
      {
        id: peerId,
      }
    ]);
    result = await sync.isSynced();
    expect(result).to.be.deep.equal(true);

  });

  it('should return false - chain synced ', async function () {
    //first case
    chainStub.isInitialized.resolves(true);
    dbStub.chain.getChainHeadSlot.resolves(2);
    repsStub.get.returns({
      latestHello: {
        headSlot: 5,
      },
    });

    let peerId: PeerId = new PeerId(Buffer.alloc(32));

    networkStub.getPeers.returns([
      {
        id: peerId,
      },
      {
        id: peerId,
      }
    ]);
    let result = await sync.isSynced();
    expect(result).to.be.deep.equal(false);

    //2nd case
    chainStub.isInitialized.resolves(true);
    dbStub.chain.getChainHeadSlot.resolves(10);
    repsStub.get.returns({
      latestHello: {
        headSlot: 5,
      },
    });

    networkStub.getPeers.returns(null);
    result = await sync.isSynced();
    expect(result).to.be.deep.equal(false);

  });
});
