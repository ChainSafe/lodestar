import sinon, {SinonStubbedInstance} from "sinon";
import {expect} from "chai";
import {ssz} from "@chainsafe/lodestar-types";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {config} from "@chainsafe/lodestar-config/default";
import {assembleBody} from "../../../../../src/chain/factory/block/body";
import {generateCachedState} from "../../../../utils/state";
import {generateEmptyAttestation} from "../../../../utils/attestation";
import {generateEmptySignedVoluntaryExit} from "../../../../utils/voluntaryExits";
import {generateDeposit} from "../../../../utils/deposit";
import {StubbedBeaconDb} from "../../../../utils/stub";
import {Eth1ForBlockProduction} from "../../../../../src/eth1";
import {BeaconChain} from "../../../../../src/chain";
import {AggregatedAttestationPool, OpPool} from "../../../../../src/chain/opPools";

describe("blockAssembly - body", function () {
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  function getStubs() {
    const sandbox = sinon.createSandbox();
    const state = generateCachedState();
    const chain = sandbox.createStubInstance(BeaconChain);

    const aggregatedAttestationPool = sinon.createStubInstance(AggregatedAttestationPool);
    ((chain as unknown) as {
      aggregatedAttestationPool: SinonStubbedInstance<AggregatedAttestationPool>;
    }).aggregatedAttestationPool = aggregatedAttestationPool;

    const opPool = sandbox.createStubInstance(OpPool);
    ((chain as unknown) as {
      opPool: SinonStubbedInstance<OpPool>;
    }).opPool = opPool;

    const eth1 = sandbox.createStubInstance(Eth1ForBlockProduction);
    eth1.getEth1DataAndDeposits.resolves({eth1Data: state.eth1Data, deposits: [generateDeposit()]});
    ((chain as unknown) as {
      eth1: SinonStubbedInstance<Eth1ForBlockProduction>;
    }).eth1 = eth1;

    ((chain as unknown) as {
      config: IChainForkConfig;
    }).config = config;

    return {chain, aggregatedAttestationPool, dbStub: new StubbedBeaconDb(), eth1, opPool};
  }

  it("should generate block body", async function () {
    const {chain, opPool, dbStub, aggregatedAttestationPool} = getStubs();
    opPool.getSlashingsAndExits.returns([
      [ssz.phase0.AttesterSlashing.defaultValue()],
      [ssz.phase0.ProposerSlashing.defaultValue()],
      [generateEmptySignedVoluntaryExit()],
    ]);
    aggregatedAttestationPool.getAttestationsForBlock.returns([generateEmptyAttestation()]);
    dbStub.depositDataRoot.getDepositRootTreeAtIndex.resolves(ssz.phase0.DepositDataRootList.defaultViewDU());

    const result = await assembleBody(chain, generateCachedState(), {
      randaoReveal: Buffer.alloc(96, 0),
      graffiti: Buffer.alloc(32, 0),
      blockSlot: 1,
      parentSlot: 0,
      parentBlockRoot: Buffer.alloc(32, 0),
      proposerIndex: 1000,
    });
    expect(result).to.not.be.null;
    expect(result.randaoReveal.length).to.be.equal(96);
    expect(result.attestations.length).to.be.equal(1);
    expect(result.attesterSlashings.length).to.be.equal(1);
    expect(result.voluntaryExits.length).to.be.equal(1);
    expect(result.proposerSlashings.length).to.be.equal(1);
    expect(result.deposits.length).to.be.equal(1);
  });
});
