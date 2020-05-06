import sinon from "sinon";
import {expect} from "chai";

import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {assembleBody} from "../../../../../src/chain/factory/block/body";
import * as depositUtils from "../../../../../src/chain/factory/block/deposits";
import {generateState} from "../../../../utils/state";
import {generateEmptyAttesterSlashing, generateEmptyProposerSlashing} from "../../../../utils/slashings";
import {generateEmptyAttestation} from "../../../../utils/attestation";
import {generateEmptySignedVoluntaryExit} from "../../../../utils/voluntaryExits";
import {generateDeposit} from "../../../../utils/deposit";
import {StubbedBeaconDb} from "../../../../utils/stub";

describe("blockAssembly - body", function () {

  const sandbox = sinon.createSandbox();

  let dbStub: StubbedBeaconDb, generateDepositsStub: any;

  beforeEach(() => {
    dbStub = new StubbedBeaconDb(sandbox);
    generateDepositsStub = sandbox.stub(depositUtils, "generateDeposits");
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should generate block body", async function() {
    dbStub.proposerSlashing.values.resolves([generateEmptyProposerSlashing()]);
    dbStub.attesterSlashing.values.resolves([generateEmptyAttesterSlashing()]);
    dbStub.aggregateAndProof.getBlockAttestations.resolves([generateEmptyAttestation()]);
    dbStub.voluntaryExit.values.resolves([generateEmptySignedVoluntaryExit()]);
    dbStub.depositDataRoot.getTreeBacked.resolves(config.types.DepositDataRootList.tree.defaultValue());
    dbStub.eth1Data.values.resolves([]);
    generateDepositsStub.resolves([generateDeposit()]);
    const result = await assembleBody(
      config,
      dbStub,
      generateState(),
      Buffer.alloc(96, 0),
      Buffer.alloc(32, 0),
    );
    expect(result).to.not.be.null;
    expect(result.randaoReveal.length).to.be.equal(96);
    expect(result.attestations.length).to.be.equal(1);
    expect(result.attesterSlashings.length).to.be.equal(1);
    expect(result.voluntaryExits.length).to.be.equal(1);
    expect(result.proposerSlashings.length).to.be.equal(1);
    expect(result.deposits.length).to.be.equal(1);
    expect(dbStub.eth1Data.values.calledOnce).to.be.true;
  });

  it("should generate block body with max respective field lengths", async function() {
    dbStub.proposerSlashing.values.resolves(
      Array.from({length: config.params.MAX_PROPOSER_SLASHINGS}, generateEmptyProposerSlashing)
    );
    dbStub.attesterSlashing.values.resolves(
      Array.from({length: config.params.MAX_ATTESTER_SLASHINGS}, generateEmptyAttesterSlashing)
    );
    dbStub.aggregateAndProof.getBlockAttestations.resolves(
      Array.from({length: config.params.MAX_ATTESTATIONS}, generateEmptyAttestation)
    );
    dbStub.voluntaryExit.values.resolves(
      Array.from({length: config.params.MAX_VOLUNTARY_EXITS}, generateEmptySignedVoluntaryExit)
    );
    dbStub.depositDataRoot.getTreeBacked.resolves(config.types.DepositDataRootList.tree.defaultValue());
    dbStub.eth1Data.values.resolves([]);
    generateDepositsStub.resolves([generateDeposit()]);
    const result = await assembleBody(
      config,
      dbStub,
      generateState(),
      Buffer.alloc(96, 0),
      Buffer.alloc(32, 0),
    );
    expect(result).to.not.be.null;
    expect(result.randaoReveal.length).to.be.equal(96);
    expect(result.attestations.length).to.be.equal(config.params.MAX_ATTESTATIONS);
    expect(result.attesterSlashings.length).to.be.equal(config.params.MAX_ATTESTER_SLASHINGS);
    expect(result.voluntaryExits.length).to.be.equal(config.params.MAX_VOLUNTARY_EXITS);
    expect(result.proposerSlashings.length).to.be.equal(config.params.MAX_PROPOSER_SLASHINGS);
    expect(result.deposits.length).to.be.equal(1);
    expect(dbStub.eth1Data.values.calledOnce).to.be.true;
  });
});
