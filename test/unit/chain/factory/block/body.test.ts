import sinon from "sinon";
import {AttestationOperations, OpPool} from "../../../../../src/opPool";
import {assembleBody} from "../../../../../src/chain/factory/block/body";
import * as depositUtils from "../../../../../src/chain/factory/block/deposits";
import {generateState} from "../../../../utils/state";
import {generateEmptyAttesterSlashing, generateEmptyProposerSlashing} from "../../../../utils/slashings";
import {generateEmptyAttestation} from "../../../../utils/attestation";
import {generateEmptyVoluntaryExit} from "../../../../utils/voluntaryExits";
import * as eth1DataAssembly from "../../../../../src/chain/factory/block/eth1Data";
import {expect} from "chai";
import {
  MAX_ATTESTATIONS,
  MAX_ATTESTER_SLASHINGS,
  MAX_PROPOSER_SLASHINGS,
  MAX_VOLUNTARY_EXITS
} from "../../../../../src/constants";
import {EthersEth1Notifier} from "../../../../../src/eth1";
import {generateDeposit} from "../../../../utils/deposit";
import {ProgressiveMerkleTree} from "../../../../../src/util/merkleTree";
import {VoluntaryExitOperations} from "../../../../../src/opPool/modules/voluntaryExit";
import {DepositsOperations} from "../../../../../src/opPool/modules/deposit";
import {ProposerSlashingOperations} from "../../../../../src/opPool/modules/proposerSlashing";
import {TransferOperations} from "../../../../../src/opPool/modules/transfer";

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
    bestVoteStub = sandbox.stub(eth1DataAssembly, "bestVoteData");
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should generate block body', async function() {
    // @ts-ignore
    opPool.proposerSlashings.all.resolves([generateEmptyProposerSlashing()]);
    // @ts-ignore
    opPool.attesterSlashings.all.resolves([generateEmptyAttesterSlashing()]);
    // @ts-ignore
    opPool.attestations.all.resolves([generateEmptyAttestation()]);
    // @ts-ignore
    opPool.voluntaryExits.all.resolves([generateEmptyVoluntaryExit()]);
    generateDepositsStub.resolves([generateDeposit()]);
    bestVoteStub.resolves([]);
    const result = await assembleBody(
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
    expect(bestVoteStub.calledOnce).to.be.true;
  });

  it('should generate block body with max respective field lengths', async function() {
    // @ts-ignore
    opPool.proposerSlashings.all.resolves(new Array(MAX_PROPOSER_SLASHINGS + 1).map(generateEmptyProposerSlashing));
    // @ts-ignore
    opPool.attesterSlashings.all.resolves(new Array(MAX_ATTESTER_SLASHINGS + 1).map(generateEmptyAttesterSlashing));
    // @ts-ignore
    opPool.attestations.all.resolves(new Array(MAX_ATTESTATIONS + 1).map(generateEmptyAttestation));
    // @ts-ignore
    opPool.voluntaryExits.all.resolves(new Array(MAX_VOLUNTARY_EXITS + 1).map(generateEmptyVoluntaryExit));
    generateDepositsStub.resolves([generateDeposit()]);
    bestVoteStub.resolves([]);
    const result = await assembleBody(
      opPool,
      eth1,
      sandbox.createStubInstance(ProgressiveMerkleTree),
      generateState(),
      Buffer.alloc(96, 0)
    );
    expect(result).to.not.be.null;
    expect(result.randaoReveal.length).to.be.equal(96);
    expect(result.attestations.length).to.be.equal(MAX_ATTESTATIONS);
    expect(result.attesterSlashings.length).to.be.equal(MAX_ATTESTER_SLASHINGS);
    expect(result.voluntaryExits.length).to.be.equal(MAX_VOLUNTARY_EXITS);
    expect(result.proposerSlashings.length).to.be.equal(MAX_PROPOSER_SLASHINGS);
    expect(result.deposits.length).to.be.equal(1);
    expect(result.transfers.length).to.be.equal(0);
    expect(bestVoteStub.calledOnce).to.be.true;
  });


});
