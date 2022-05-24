import sinon, {SinonStubbedInstance} from "sinon";
import {expect} from "chai";

import {ssz} from "@chainsafe/lodestar-types";
import {config} from "@chainsafe/lodestar-config/default";
// eslint-disable-next-line no-restricted-imports
import * as processBlock from "@chainsafe/lodestar-beacon-state-transition/lib/allForks/stateTransition";
import {ForkChoice} from "@chainsafe/lodestar-fork-choice";

import {BeaconChain} from "../../../../../src/chain";
import {LocalClock} from "../../../../../src/chain/clock";
import {assembleBlock} from "../../../../../src/chain/factory/block";
import * as blockBodyAssembly from "../../../../../src/chain/factory/block/body";
import {StateRegenerator} from "../../../../../src/chain/regen";
import {Eth1ForBlockProduction} from "../../../../../src/eth1";
import {generateProtoBlock, generateEmptyBlock} from "../../../../utils/block";
import {generateCachedState} from "../../../../utils/state";
import {StubbedBeaconDb, StubbedChain} from "../../../../utils/stub";
import {SinonStubFn} from "../../../../utils/types";

describe("block assembly", function () {
  const sandbox = sinon.createSandbox();

  let assembleBodyStub: SinonStubFn<typeof blockBodyAssembly["assembleBody"]>,
    chainStub: StubbedChain,
    forkChoiceStub: SinonStubbedInstance<ForkChoice>,
    regenStub: SinonStubbedInstance<StateRegenerator>,
    processBlockStub: SinonStubFn<typeof processBlock["processBlock"]>,
    beaconDB: StubbedBeaconDb;

  beforeEach(() => {
    assembleBodyStub = sandbox.stub(blockBodyAssembly, "assembleBody");
    processBlockStub = sandbox.stub(processBlock, "processBlock");

    chainStub = sandbox.createStubInstance(BeaconChain) as StubbedChain;
    forkChoiceStub = chainStub.forkChoice = sandbox.createStubInstance(ForkChoice);
    chainStub.clock = sandbox.createStubInstance(LocalClock);
    regenStub = chainStub.regen = sandbox.createStubInstance(StateRegenerator);

    beaconDB = new StubbedBeaconDb();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should assemble block", async function () {
    sandbox.stub(chainStub.clock, "currentSlot").get(() => 1);
    forkChoiceStub.getHead.returns(generateProtoBlock());
    const state = generateCachedState({slot: 1});
    sinon.stub(state.epochCtx, "getBeaconProposer").returns(2);
    regenStub.getBlockSlotState.resolves(state);
    beaconDB.depositDataRoot.getDepositRootTreeAtIndex.resolves(ssz.phase0.DepositDataRootList.defaultViewDU());
    assembleBodyStub.resolves(generateEmptyBlock().body);

    const eth1 = sandbox.createStubInstance(Eth1ForBlockProduction);
    eth1.getEth1DataAndDeposits.resolves({eth1Data: state.eth1Data, deposits: []});
    ((chainStub as unknown) as {eth1: typeof eth1}).eth1 = eth1;
    ((chainStub as unknown) as {config: typeof config}).config = config;

    const result = await assembleBlock(
      {chain: chainStub, metrics: null},
      {
        randaoReveal: Buffer.alloc(96, 0),
        graffiti: Buffer.alloc(32, 0),
        slot: 1,
      }
    );
    expect(result).to.not.be.null;
    expect(result.slot).to.equal(1);
    expect(result.proposerIndex).to.equal(2);
    expect(result.stateRoot).to.not.be.null;
    expect(result.parentRoot).to.not.be.null;
    expect(regenStub.getBlockSlotState.calledOnce).to.be.true;
    expect(processBlockStub.calledOnce).to.be.true;
    expect(assembleBodyStub.calledOnce).to.be.true;
  });
});
