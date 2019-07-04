import sinon from "sinon";
import {expect} from "chai";

import {config} from "../../../../../src/config/presets/mainnet";
import {OpPool} from "../../../../../src/opPool";
import {assembleBody} from "../../../../../src/chain/factory/block/body";
import * as depositUtils from "../../../../../src/chain/factory/block/deposits";
import * as eth1DataAssembly from "../../../../../src/chain/factory/block/eth1Data";
import {EthersEth1Notifier} from "../../../../../src/eth1";
import {ProgressiveMerkleTree} from "../../../../../src/util/merkleTree";
import {generateState} from "../../../../utils/state";
import {generateEmptyAttesterSlashing, generateEmptyProposerSlashing} from "../../../../utils/slashings";
import {generateEmptyAttestation} from "../../../../utils/attestation";
import {generateEmptyVoluntaryExit} from "../../../../utils/voluntaryExits";
import {generateDeposit} from "../../../../utils/deposit";

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
    expect(bestVoteStub.calledOnce).to.be.true;
  });

  it('should generate block body with max respective field lengths', async function() {
    opPool.getProposerSlashings.resolves(new Array(config.params.MAX_PROPOSER_SLASHINGS + 1).map(generateEmptyProposerSlashing));
    opPool.getAttesterSlashings.resolves(new Array(config.params.MAX_ATTESTER_SLASHINGS + 1).map(generateEmptyAttesterSlashing));
    opPool.getAttestations.resolves(new Array(config.params.MAX_ATTESTATIONS + 1).map(generateEmptyAttestation));
    opPool.getVoluntaryExits.resolves(new Array(config.params.MAX_VOLUNTARY_EXITS + 1).map(generateEmptyVoluntaryExit));
    generateDepositsStub.resolves([generateDeposit()]);
    bestVoteStub.resolves([]);
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
    expect(bestVoteStub.calledOnce).to.be.true;
  });
});
