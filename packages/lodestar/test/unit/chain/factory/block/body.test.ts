import sinon from "sinon";
import {expect} from "chai";

import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";
import {
  AttestationOperations,
  DepositsOperations,
  OpPool,
  ProposerSlashingOperations,
  TransferOperations,
  VoluntaryExitOperations
} from "../../../../../src/opPool";
import {assembleBody} from "../../../../../src/chain/factory/block/body";
import * as depositUtils from "../../../../../src/chain/factory/block/deposits";
import {describe, it} from "mocha";
import {EthersEth1Notifier} from "../../../../../src/eth1";
import {ProgressiveMerkleTree} from "../../../../../src/util/merkleTree";
import {generateState} from "../../../../utils/state";
import {generateEmptyAttesterSlashing, generateEmptyProposerSlashing} from "../../../../utils/slashings";
import {generateEmptyAttestation} from "../../../../utils/attestation";
import {generateEmptyVoluntaryExit} from "../../../../utils/voluntaryExits";
import {generateDeposit} from "../../../../utils/deposit";

describe('blockAssembly - body', function () {

  const sandbox = sinon.createSandbox();

  let opPool: OpPool, eth1, generateDepositsStub, bestVoteStub;

  beforeEach(() => {
    opPool = {
      attestations: sandbox.createStubInstance(AttestationOperations),
      voluntaryExits: sandbox.createStubInstance(VoluntaryExitOperations),
      deposits: sandbox.createStubInstance(DepositsOperations),
      transfers: sandbox.createStubInstance(TransferOperations),
      proposerSlashings: sandbox.createStubInstance(ProposerSlashingOperations),
      attesterSlashings: sandbox.createStubInstance(AttestationOperations),
    } as unknown as OpPool;
    generateDepositsStub = sandbox.stub(depositUtils, "generateDeposits");
    eth1 = sandbox.createStubInstance(EthersEth1Notifier);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should generate block body', async function() {
    // @ts-ignore
    opPool.proposerSlashings.getAll.resolves([generateEmptyProposerSlashing()]);
    // @ts-ignore
    opPool.attesterSlashings.getAll.resolves([generateEmptyAttesterSlashing()]);
    // @ts-ignore
    opPool.attestations.getAll.resolves([generateEmptyAttestation()]);
    // @ts-ignore
    opPool.voluntaryExits.getAll.resolves([generateEmptyVoluntaryExit()]);
    generateDepositsStub.resolves([generateDeposit()]);
    eth1.getEth1Data.resolves([]);
    const result = await assembleBody(
      config,
      opPool,
      eth1,
      sandbox.createStubInstance(ProgressiveMerkleTree),
      generateState(),
      Buffer.alloc(96, 0)
    );
    expect(result).to.not.be.null;
    expect(result.randaoReveal.length).to.be.equal(96);
    expect(result.attestations.length).to.be.equal(1);
    expect(result.attesterSlashings.length).to.be.equal(1);
    expect(result.voluntaryExits.length).to.be.equal(1);
    expect(result.proposerSlashings.length).to.be.equal(1);
    expect(result.deposits.length).to.be.equal(1);
    expect(result.transfers.length).to.be.equal(0);
    expect(eth1.getEth1Data.calledOnce).to.be.true;
  });

  it('should generate block body with max respective field lengths', async function() {
    // @ts-ignore
    opPool.proposerSlashings.getAll.resolves(new Array(config.params.MAX_PROPOSER_SLASHINGS + 1).map(generateEmptyProposerSlashing));
    // @ts-ignore
    opPool.attesterSlashings.getAll.resolves(new Array(config.params.MAX_ATTESTER_SLASHINGS + 1).map(generateEmptyAttesterSlashing));
    // @ts-ignore
    opPool.attestations.getAll.resolves(new Array(config.params.MAX_ATTESTATIONS + 1).map(generateEmptyAttestation));
    // @ts-ignore
    opPool.voluntaryExits.getAll.resolves(new Array(config.params.MAX_VOLUNTARY_EXITS + 1).map(generateEmptyVoluntaryExit));
    generateDepositsStub.resolves([generateDeposit()]);
    eth1.getEth1Data.resolves([]);
    const result = await assembleBody(
      config,
      opPool,
      eth1,
      sandbox.createStubInstance(ProgressiveMerkleTree),
      generateState(),
      Buffer.alloc(96, 0)
    );
    expect(result).to.not.be.null;
    expect(result.randaoReveal.length).to.be.equal(96);
    expect(result.attestations.length).to.be.equal(config.params.MAX_ATTESTATIONS);
    expect(result.attesterSlashings.length).to.be.equal(config.params.MAX_ATTESTER_SLASHINGS);
    expect(result.voluntaryExits.length).to.be.equal(config.params.MAX_VOLUNTARY_EXITS);
    expect(result.proposerSlashings.length).to.be.equal(config.params.MAX_PROPOSER_SLASHINGS);
    expect(result.deposits.length).to.be.equal(1);
    expect(result.transfers.length).to.be.equal(0);
    expect(eth1.getEth1Data.calledOnce).to.be.true;
  });
});
