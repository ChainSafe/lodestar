import sinon from "sinon";
import {expect} from "chai";

import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {assembleBody} from "../../../../../src/chain/factory/block/body";
import * as depositUtils from "../../../../../src/chain/factory/block/deposits";
import {EthersEth1Notifier} from "../../../../../src/eth1";
import {generateState} from "../../../../utils/state";
import {generateEmptyAttesterSlashing, generateEmptyProposerSlashing} from "../../../../utils/slashings";
import {generateEmptyAttestation} from "../../../../utils/attestation";
import {generateEmptySignedVoluntaryExit} from "../../../../utils/voluntaryExits";
import {generateDeposit} from "../../../../utils/deposit";
import {StubbedBeaconDb} from "../../../../utils/stub";

describe("blockAssembly - body", function () {

  const sandbox = sinon.createSandbox();

  let dbStub: StubbedBeaconDb, eth1: any, generateDepositsStub: any;

  beforeEach(() => {
    dbStub = new StubbedBeaconDb(sandbox);
    generateDepositsStub = sandbox.stub(depositUtils, "generateDeposits");
    eth1 = sandbox.createStubInstance(EthersEth1Notifier);
    eth1.getEth1Vote = sandbox.stub();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should generate block body", async function() {
    dbStub.proposerSlashing.values.resolves([generateEmptyProposerSlashing()]);
    dbStub.attesterSlashing.values.resolves([generateEmptyAttesterSlashing()]);
    dbStub.aggregateAndProof.getBlockAttestations.resolves([generateEmptyAttestation()]);
    dbStub.voluntaryExit.values.resolves([generateEmptySignedVoluntaryExit()]);
    generateDepositsStub.resolves([generateDeposit()]);
    eth1.getEth1Vote.resolves([]);
    const result = await assembleBody(
      config,
      dbStub,
      eth1,
      config.types.DepositDataRootList.tree.defaultValue(),
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
    expect(eth1.getEth1Vote.calledOnce).to.be.true;
  });

  it("should generate block body with max respective field lengths", async function() {
    dbStub.proposerSlashing.values.resolves(
      new Array(config.params.MAX_PROPOSER_SLASHINGS + 1).map(generateEmptyProposerSlashing)
    );
    dbStub.attesterSlashing.values.resolves(
      new Array(config.params.MAX_ATTESTER_SLASHINGS + 1).map(generateEmptyAttesterSlashing)
    );
    dbStub.aggregateAndProof.getBlockAttestations.resolves(
      new Array(config.params.MAX_ATTESTATIONS + 1).map(generateEmptyAttestation)
    );
    dbStub.voluntaryExit.values.resolves(
      new Array(config.params.MAX_VOLUNTARY_EXITS + 1).map(generateEmptySignedVoluntaryExit)
    );
    generateDepositsStub.resolves([generateDeposit()]);
    eth1.getEth1Vote.resolves([]);
    const result = await assembleBody(
      config,
      dbStub,
      eth1,
      config.types.DepositDataRootList.tree.defaultValue(),
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
    expect(eth1.getEth1Vote.calledOnce).to.be.true;
  });
});
