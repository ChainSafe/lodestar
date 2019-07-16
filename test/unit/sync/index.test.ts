import sinon from "sinon";
import {expect} from  "chai";
import {BeaconChain} from "../../../src/chain";
import {Libp2pNetwork} from "../../../src/network";
import {OpPool} from "../../../src/opPool";
import {EthersEth1Notifier} from "../../../src/eth1";
import {BeaconDB} from "../../../src/db/api";
import {ReputationStore} from "../../../src/sync/reputation";
import {WinstonLogger} from "../../../src/logger";
import {RegularSync} from "../../../src/sync/regular";
import {Sync} from "../../../src/sync";
import PeerId from "peer-id";
import {config} from "../../../src/config/presets/mainnet";

describe("syncing", function () {
  let sandbox = sinon.createSandbox();
  let sync: Sync;
  let chainStub, networkStub, opPoolStub, eth1Stub, dbStub,
    repsStub, logger, syncerStub;

  beforeEach(() => {
    chainStub = sandbox.createStubInstance(BeaconChain);
    networkStub = sandbox.createStubInstance(Libp2pNetwork);
    opPoolStub = sandbox.createStubInstance(OpPool);
    eth1Stub = sandbox.createStubInstance(EthersEth1Notifier);
    dbStub = sandbox.createStubInstance(BeaconDB);
    repsStub = sandbox.createStubInstance(ReputationStore);
    logger = new WinstonLogger();
    syncerStub = sandbox.createStubInstance(RegularSync);
    logger.silent(true);


    sync = new Sync({}, {
      config,
      chain: chainStub,
      db: dbStub,
      eth1: eth1Stub,
      network: networkStub,
      opPool: opPoolStub,
      reps: repsStub,
      logger: logger,
    }
    );
  });

  afterEach(() => {
    sandbox.restore();
    logger.silent(false);
  });


  it('should return true - chain synced ', async function () {

    //first case
    eth1Stub.isAfterEth2Genesis.resolves(false);
    let result = await sync.isSynced();
    expect(result).to.be.deep.equal(true);

    //2nd case
    eth1Stub.isAfterEth2Genesis.resolves(true);
    dbStub.getChainHeadSlot.resolves(10);
    repsStub.get.returns({
      latestHello: {bestSlot: 5},
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
    eth1Stub.isAfterEth2Genesis.resolves(true);
    dbStub.getChainHeadSlot.resolves(2);
    repsStub.get.returns({
      latestHello: {
        bestSlot: 5,
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
    eth1Stub.isAfterEth2Genesis.resolves(true);
    dbStub.getChainHeadSlot.resolves(10);
    repsStub.get.returns({
      latestHello: {
        bestSlot: 5,
      },
    });

    networkStub.getPeers.returns(null);
    result = await sync.isSynced();
    expect(result).to.be.deep.equal(false);

  });

  it('should start an stop syncing', async function () {

    eth1Stub.isAfterEth2Genesis.resolves(true);
    dbStub.getChainHeadSlot.resolves(-1);
    repsStub.get.returns({
      latestHello: {
        bestSlot: 0,
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

    syncerStub.start.resolves(null);
    try {
      await sync.start();
      await sync.stop();
    }catch (e) {
      expect.fail(e.stack);
    }
  });

});
