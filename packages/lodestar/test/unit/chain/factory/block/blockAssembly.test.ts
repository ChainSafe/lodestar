import sinon from "sinon";
import {expect} from "chai";

import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import * as blockBodyAssembly from "../../../../../src/chain/factory/block/body";
import * as blockTransitions from "@chainsafe/lodestar-beacon-state-transition/lib/fast";
import {assembleBlock} from "../../../../../src/chain/factory/block";
import {generateState} from "../../../../utils/state";
import {ArrayDagLMDGHOST} from "../../../../../../lodestar/src/chain/forkChoice";
import {BeaconChain} from "../../../../../src/chain";
import {generateEmptyBlock, generateEmptySignedBlock} from "../../../../utils/block";
import {StubbedBeaconDb, StubbedChain} from "../../../../utils/stub";
import {EpochContext} from "@chainsafe/lodestar-beacon-state-transition";

describe("block assembly", function () {
  const sandbox = sinon.createSandbox();

  let assembleBodyStub: any,
    chainStub: StubbedChain,
    forkChoiceStub: any,
    stateTransitionStub: any,
    beaconDB: StubbedBeaconDb;

  beforeEach(() => {
    assembleBodyStub = sandbox.stub(blockBodyAssembly, "assembleBody");
    stateTransitionStub = sandbox.stub(blockTransitions, "fastStateTransition");

    forkChoiceStub = sandbox.createStubInstance(ArrayDagLMDGHOST);
    chainStub = (sandbox.createStubInstance(BeaconChain) as unknown) as StubbedChain;
    chainStub.forkChoice = forkChoiceStub;

    beaconDB = new StubbedBeaconDb(sandbox);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should assemble block", async function () {
    chainStub.getHeadBlock.resolves(generateEmptySignedBlock());
    chainStub.getHeadStateContext.resolves({
      state: generateState({slot: 1}),
      epochCtx: new EpochContext(config),
    });
    beaconDB.depositDataRoot.getTreeBacked.resolves(config.types.DepositDataRootList.tree.defaultValue());
    assembleBodyStub.resolves(generateEmptyBlock().body);
    stateTransitionStub.returns({state: generateState()});
    try {
      const result = await assembleBlock(config, chainStub, beaconDB, 1, 1, Buffer.alloc(96, 0));
      expect(result).to.not.be.null;
      expect(result.slot).to.equal(1);
      expect(result.stateRoot).to.not.be.null;
      expect(result.parentRoot).to.not.be.null;
      expect(chainStub.getHeadStateContext.calledOnce).to.be.true;
      expect(chainStub.getHeadBlock.calledOnce).to.be.true;
      expect(assembleBodyStub.calledOnce).to.be.true;
    } catch (e) {
      expect.fail(e.stack);
    }
  });
});
