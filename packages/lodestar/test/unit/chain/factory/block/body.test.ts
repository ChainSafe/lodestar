import sinon from "sinon";
import {expect} from "chai";

import {ssz} from "@chainsafe/lodestar-types";
import {
  MAX_ATTESTATIONS,
  MAX_ATTESTER_SLASHINGS,
  MAX_PROPOSER_SLASHINGS,
  MAX_VOLUNTARY_EXITS,
} from "@chainsafe/lodestar-params";
import {config} from "@chainsafe/lodestar-config/default";
import {assembleBody} from "../../../../../src/chain/factory/block/body";
import {generateCachedState} from "../../../../utils/state";
import {generateEmptyAttestation} from "../../../../utils/attestation";
import {generateEmptySignedVoluntaryExit} from "../../../../utils/voluntaryExits";
import {generateDeposit} from "../../../../utils/deposit";
import {StubbedBeaconDb} from "../../../../utils/stub";
import {Eth1ForBlockProduction} from "../../../../../src/eth1/";
import {BeaconChain} from "../../../../../src/chain";

describe("blockAssembly - body", function () {
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  function getStubs() {
    const sandbox = sinon.createSandbox();
    const state = generateCachedState();
    const eth1 = sandbox.createStubInstance(Eth1ForBlockProduction);
    eth1.getEth1DataAndDeposits.resolves({eth1Data: state.eth1Data, deposits: [generateDeposit()]});
    const chain = sandbox.createStubInstance(BeaconChain);

    return {chain, dbStub: new StubbedBeaconDb(sandbox), eth1};
  }

  it("should generate block body", async function () {
    const {chain, dbStub, eth1} = getStubs();
    dbStub.proposerSlashing.values.resolves([ssz.phase0.ProposerSlashing.defaultValue()]);
    dbStub.attesterSlashing.values.resolves([ssz.phase0.AttesterSlashing.defaultValue()]);
    dbStub.aggregateAndProof.getBlockAttestations.resolves([generateEmptyAttestation()]);
    dbStub.voluntaryExit.values.resolves([generateEmptySignedVoluntaryExit()]);
    dbStub.depositDataRoot.getTreeBacked.resolves(ssz.phase0.DepositDataRootList.defaultTreeBacked());

    const result = await assembleBody(
      {chain, config, db: dbStub, eth1},
      generateCachedState(),
      Buffer.alloc(96, 0),
      Buffer.alloc(32, 0),
      1,
      {parentSlot: 0, parentBlockRoot: Buffer.alloc(32, 0)}
    );
    expect(result).to.not.be.null;
    expect(result.randaoReveal.length).to.be.equal(96);
    expect(result.attestations.length).to.be.equal(1);
    expect(result.attesterSlashings.length).to.be.equal(1);
    expect(result.voluntaryExits.length).to.be.equal(1);
    expect(result.proposerSlashings.length).to.be.equal(1);
    expect(result.deposits.length).to.be.equal(1);
  });

  it("should generate block body with max respective field lengths", async function () {
    const {chain, dbStub, eth1} = getStubs();
    dbStub.proposerSlashing.values.resolves(
      Array.from({length: MAX_PROPOSER_SLASHINGS}, () => ssz.phase0.ProposerSlashing.defaultValue())
    );
    dbStub.attesterSlashing.values.resolves(
      Array.from({length: MAX_ATTESTER_SLASHINGS}, () => ssz.phase0.AttesterSlashing.defaultValue())
    );
    dbStub.aggregateAndProof.getBlockAttestations.resolves(
      Array.from({length: MAX_ATTESTATIONS}, generateEmptyAttestation)
    );
    dbStub.voluntaryExit.values.resolves(Array.from({length: MAX_VOLUNTARY_EXITS}, generateEmptySignedVoluntaryExit));

    const result = await assembleBody(
      {chain, config, db: dbStub, eth1},
      generateCachedState(),
      Buffer.alloc(96, 0),
      Buffer.alloc(32, 0),
      1,
      {parentSlot: 0, parentBlockRoot: Buffer.alloc(32, 0)}
    );
    expect(result).to.not.be.null;
    expect(result.randaoReveal.length).to.be.equal(96);
    expect(result.attestations.length).to.be.equal(MAX_ATTESTATIONS);
    expect(result.attesterSlashings.length).to.be.equal(MAX_ATTESTER_SLASHINGS);
    expect(result.voluntaryExits.length).to.be.equal(MAX_VOLUNTARY_EXITS);
    expect(result.proposerSlashings.length).to.be.equal(MAX_PROPOSER_SLASHINGS);
    expect(result.deposits.length).to.be.equal(1);
  });
});
