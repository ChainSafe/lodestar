import sinon, {SinonStubbedInstance} from "sinon";
import {expect} from "chai";

import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {EpochContext} from "@chainsafe/lodestar-beacon-state-transition";
import * as blockTransitions from "@chainsafe/lodestar-beacon-state-transition/lib/fast";
import {ForkChoice} from "@chainsafe/lodestar-fork-choice";

import {BeaconChain} from "../../../../../src/chain";
import {LocalClock} from "../../../../../src/chain/clock";
import {assembleBlock} from "../../../../../src/chain/factory/block";
import * as blockBodyAssembly from "../../../../../src/chain/factory/block/body";
import {StateRegenerator} from "../../../../../src/chain/regen";
import {Eth1ForBlockProduction} from "../../../../../src/eth1/";
import {generateBlockSummary, generateEmptyBlock} from "../../../../utils/block";
import {generateState} from "../../../../utils/state";
import {StubbedBeaconDb, StubbedChain} from "../../../../utils/stub";

describe("block assembly", function () {
  const sandbox = sinon.createSandbox();

  let assembleBodyStub: any,
    chainStub: StubbedChain,
    forkChoiceStub: SinonStubbedInstance<ForkChoice>,
    regenStub: SinonStubbedInstance<StateRegenerator>,
    stateTransitionStub: any,
    beaconDB: StubbedBeaconDb;

  beforeEach(() => {
    assembleBodyStub = sandbox.stub(blockBodyAssembly, "assembleBody");
    stateTransitionStub = sandbox.stub(blockTransitions, "fastStateTransition");

    chainStub = (sandbox.createStubInstance(BeaconChain) as unknown) as StubbedChain;
    forkChoiceStub = chainStub.forkChoice = sandbox.createStubInstance(ForkChoice);
    chainStub.clock = sandbox.createStubInstance(LocalClock);
    regenStub = chainStub.regen = sandbox.createStubInstance(StateRegenerator);

    beaconDB = new StubbedBeaconDb(sandbox);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should assemble block", async function () {
    sandbox.stub(chainStub.clock, "currentSlot").get(() => 1);
    forkChoiceStub.getHead.returns(generateBlockSummary());
    regenStub.getBlockSlotState.resolves({
      state: generateState({slot: 1}),
      epochCtx: new EpochContext(config),
    });
    beaconDB.depositDataRoot.getTreeBacked.resolves(config.types.DepositDataRootList.tree.defaultValue());
    assembleBodyStub.resolves(generateEmptyBlock().body);
    const state = generateState();
    stateTransitionStub.returns({state});

    const eth1 = sandbox.createStubInstance(Eth1ForBlockProduction);
    eth1.getEth1DataAndDeposits.resolves({eth1Data: state.eth1Data, deposits: []});

    try {
      const result = await assembleBlock(config, chainStub, beaconDB, eth1, 1, 1, Buffer.alloc(96, 0));
      expect(result).to.not.be.null;
      expect(result.slot).to.equal(1);
      expect(result.stateRoot).to.not.be.null;
      expect(result.parentRoot).to.not.be.null;
      expect(regenStub.getBlockSlotState.calledTwice).to.be.true;
      expect(assembleBodyStub.calledOnce).to.be.true;
    } catch (e) {
      expect.fail(e.stack);
    }
  });
});
