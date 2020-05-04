import sinon from "sinon";
import {expect} from "chai";

import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import * as blockBodyAssembly from "../../../../../src/chain/factory/block/body";
import * as blockTransitions from "@chainsafe/lodestar-beacon-state-transition";
import {assembleBlock} from "../../../../../src/chain/factory/block";
import {EthersEth1Notifier} from "../../../../../src/eth1";
import {generateState} from "../../../../utils/state";
import {StatefulDagLMDGHOST} from "../../../../../../lodestar/src/chain/forkChoice";
import {BeaconChain} from "../../../../../src/chain";
import {generateEmptyBlock, generateEmptySignedBlock} from "../../../../utils/block";
import {StubbedBeaconDb, StubbedChain} from "../../../../utils/stub";

describe("block assembly", function () {

  const sandbox = sinon.createSandbox();

  let assembleBodyStub: any, chainStub: StubbedChain, forkChoiceStub: any, stateTransitionStub: any, beaconDB: StubbedBeaconDb, eth1: any;

  beforeEach(() => {
    assembleBodyStub = sandbox.stub(blockBodyAssembly, "assembleBody");
    stateTransitionStub = sandbox.stub(blockTransitions, "stateTransition");


    forkChoiceStub = sandbox.createStubInstance(StatefulDagLMDGHOST);
    chainStub = sandbox.createStubInstance(BeaconChain) as unknown as StubbedChain;
    chainStub.forkChoice = forkChoiceStub;

    beaconDB = new StubbedBeaconDb(sandbox);
    eth1 = sandbox.createStubInstance(EthersEth1Notifier);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should assemble block", async function () {
    const head = chainStub.forkChoice.head();
    beaconDB.block.get.withArgs(head).resolves(generateEmptySignedBlock());
    beaconDB.state.get.resolves(generateState({slot: 1}));
    beaconDB.depositDataRootList.get.resolves(config.types.DepositDataRootList.tree.defaultValue());
    assembleBodyStub.resolves(generateEmptyBlock().body);
    stateTransitionStub.returns(generateState());
    try {
      const result = await assembleBlock(config, chainStub, beaconDB, eth1, 1, 1, Buffer.alloc(96, 0));
      expect(result).to.not.be.null;
      expect(result.slot).to.equal(1);
      expect(result.stateRoot).to.not.be.null;
      expect(result.parentRoot).to.not.be.null;
      expect(beaconDB.state.get.calledOnce).to.be.true;
      expect(beaconDB.block.get.calledOnceWith(head));
      expect(assembleBodyStub.calledOnce).to.be.true;
    } catch (e) {
      expect.fail(e.stack);
    }
  });
});
