import sinon from "sinon";
import {expect} from "chai";
import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";

import {BeaconChain} from "../../../src/chain";
import {Libp2pNetwork} from "../../../src/network";
import {AttestationOperations, OpPool} from "../../../src/opPool";
import {WinstonLogger} from "../../../src/logger";
import {RegularSync} from "../../../src/sync/regular";
import {generateState} from "../../utils/state";
import {generateEmptyBlock} from "../../utils/block";
import {generateEmptyAttestation} from "../../utils/attestation";
import {AttestationRepository, BlockRepository, StateRepository} from "../../../src/db/api/beacon/repositories";

describe("syncing", function () {
  let sandbox = sinon.createSandbox();
  let regularSync: RegularSync;
  let chainStub, networkStub, dbStub, opPoolStub, logger;

  beforeEach(() => {
    chainStub = sandbox.createStubInstance(BeaconChain);
    networkStub = sandbox.createStubInstance(Libp2pNetwork);
    dbStub = {
      block: sandbox.createStubInstance(BlockRepository),
      attestation: sandbox.createStubInstance(AttestationRepository),
      state: sandbox.createStubInstance(StateRepository),
    };
    opPoolStub = sandbox.createStubInstance(OpPool);
    logger = new WinstonLogger();
    logger.silent = true;
    regularSync = new RegularSync({}, {
      config,
      db: dbStub,
      chain: chainStub,
      network: networkStub,
      opPool: opPoolStub,
      logger: logger,
    });
  });

  afterEach(() => {
    sandbox.restore();
    logger.silent = false;
  });


  it('should able to receive block', async function () {
    let block = generateEmptyBlock();
    dbStub.block.has.resolves(false);
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
    dbStub.attestation.has.resolves(true);
    try {
      await regularSync.receiveAttestation(attestation);
    }catch (e) {
      expect.fail(e.stack);
    }

  });
  it('should skip attestation - too old', async function () {
    let attestation = generateEmptyAttestation();
    let state = generateState();
    state.finalizedCheckpoint.epoch = 2;
    attestation.data.target.epoch = 1;
    dbStub.attestation.has.resolves(false);
    dbStub.state.getLatest.resolves(state);
    try {
      await regularSync.receiveAttestation(attestation);
    }catch (e) {
      expect.fail(e.stack);
    }

  });
  it('should receive attestation', async function () {
    let attestation = generateEmptyAttestation();
    let state = generateState();
    state.finalizedCheckpoint.epoch = 1;
    attestation.data.target.epoch = 2;
    dbStub.attestation.has.resolves(false);
    dbStub.state.getLatest.resolves(state);
    opPoolStub.attestations = new AttestationOperations(dbStub.attestation);
    dbStub.attestation.setUnderRoot.resolves(0);
    chainStub.receiveAttestation.resolves(0);
    try {
      await regularSync.receiveAttestation(attestation);
      expect(chainStub.receiveAttestation.calledOnceWith(attestation)).to.be.true;
    }catch (e) {
      expect.fail(e.stack);
    }
  });
});
