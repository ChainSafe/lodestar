import sinon from "sinon";
import {expect} from  "chai";
import {BeaconChain} from "../../../src/chain";
import {Libp2pNetwork} from "../../../src/network";
import {OpPool} from "../../../src/opPool";
import {BeaconDB} from "../../../src/db/api";
import {WinstonLogger} from "../../../src/logger";
import {RegularSync} from "../../../src/sync/regular";
import {generateState} from "../../utils/state";
import {generateEmptyBlock} from "../../utils/block";
import {generateEmptyAttestation} from "../../utils/attestation";
import {slotToEpoch} from "../../../src/chain/stateTransition/util";


describe("syncing", function () {
  let sandbox = sinon.createSandbox();
  let regularSync: RegularSync;
  let chainStub, networkStub, dbStub, opPool, logger;

  beforeEach(() => {
    chainStub = sandbox.createStubInstance(BeaconChain);
    networkStub = sandbox.createStubInstance(Libp2pNetwork);
    dbStub = sandbox.createStubInstance(BeaconDB);
    opPool = sandbox.createStubInstance(OpPool);
    logger = new WinstonLogger();
    logger.silent(true);

    regularSync = new RegularSync({}, {
      db: dbStub,
      chain: chainStub,
      network: networkStub,
      opPool: opPool,
      logger: logger,
    });
  });

  afterEach(() => {
    sandbox.restore();
    logger.silent(false);
  });


  it('should able to receive block', async function () {
    let block = generateEmptyBlock();
    dbStub.hasBlock.resolves(false);
    chainStub.receiveBlock.resolves(0);
    try {
      await regularSync.receiveBlock(block);
      expect(chainStub.receiveBlock.calledOnceWith(block)).to.be.true;
    }catch (e) {
      expect.fail(e.stack);
    }

  });

  it('should skip attestation - already exists', async function () {
    let attestation = generateEmptyAttestation();
    dbStub.hasAttestation.resolves(true);
    try {
      await regularSync.receiveAttestation(attestation);
    }catch (e) {
      expect.fail(e.stack);
    }

  });
  it('should skip attestation - too old', async function () {
    let attestation = generateEmptyAttestation();
    let state = generateState();
    state.finalizedEpoch = 128;
    attestation.data.targetEpoch = 1;
    dbStub.hasAttestation.resolves(false);
    dbStub.getLatestState.resolves(state);
    try {
      await regularSync.receiveAttestation(attestation);
      expect(slotToEpoch(state.finalizedEpoch)).gt(attestation.data.targetEpoch);
    }catch (e) {
      expect.fail(e.stack);
    }

  });
  it('should receive attestation', async function () {
    let attestation = generateEmptyAttestation();
    let state = generateState();
    state.finalizedEpoch = 64;
    attestation.data.targetEpoch = 1;
    dbStub.hasAttestation.resolves(false);
    dbStub.getLatestState.resolves(state);
    opPool.receiveAttestation.resolves(0);
    chainStub.receiveAttestation.resolves(0);
    try {
      await regularSync.receiveAttestation(attestation);
      expect(opPool.receiveAttestation.calledOnceWith(attestation)).to.be.true;
      expect(chainStub.receiveAttestation.calledOnceWith(attestation)).to.be.true;
    }catch (e) {
      expect.fail(e.stack);
    }
  });
});
