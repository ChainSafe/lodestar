import sinon from "sinon";
import {OpPool} from "../../../../../opPool";
import {assembleBody} from "../../../../../chain/factory/block/body";
import * as depositUtils from "../../../../../chain/factory/block/deposits";
import {generateState} from "../../../../utils/state";
import {generateEmptyAttesterSlashing, generateEmptyProposerSlashing} from "../../../../utils/slashings";
import {generateEmptyAttestation} from "../../../../utils/attestation";
import {generateEmptyVoluntaryExit} from "../../../../utils/voluntaryExits";
import * as eth1DataAssembly from "../../../../../chain/factory/block/eth1Data";
import {expect} from "chai";
import {
  MAX_ATTESTATIONS,
  MAX_ATTESTER_SLASHINGS,
  MAX_PROPOSER_SLASHINGS,
  MAX_VOLUNTARY_EXITS
} from "../../../../../constants";
import {EthersEth1Notifier} from "../../../../../eth1";
import {generateDeposit} from "../../../../utils/deposit";
import {ProgressiveMerkleTree} from "../../../../../util/merkleTree";

describe('blockAssembly - body', function () {

  const sandbox = sinon.createSandbox();

  let opPool, eth1, generateDepositsStub, bestVoteStub;

  beforeEach(() => {
    opPool = sandbox.createStubInstance(OpPool);
    generateDepositsStub = sandbox.stub(depositUtils, "generateDeposits");
    eth1 = sandbox.createStubInstance(EthersEth1Notifier);
    bestVoteStub = sandbox.stub(eth1DataAssembly, "bestVoteData");
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should generate block body', async function() {
    opPool.getProposerSlashings.resolves([generateEmptyProposerSlashing()]);
    opPool.getAttesterSlashings.resolves([generateEmptyAttesterSlashing()]);
    opPool.getAttestations.resolves([generateEmptyAttestation()]);
    opPool.getVoluntaryExits.resolves([generateEmptyVoluntaryExit()]);
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
    opPool.getProposerSlashings.resolves(new Array(MAX_PROPOSER_SLASHINGS + 1).map(generateEmptyProposerSlashing));
    opPool.getAttesterSlashings.resolves(new Array(MAX_ATTESTER_SLASHINGS + 1).map(generateEmptyAttesterSlashing));
    opPool.getAttestations.resolves(new Array(MAX_ATTESTATIONS + 1).map(generateEmptyAttestation));
    opPool.getVoluntaryExits.resolves(new Array(MAX_VOLUNTARY_EXITS + 1).map(generateEmptyVoluntaryExit));
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
