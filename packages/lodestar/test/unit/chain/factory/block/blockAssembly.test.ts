import sinon from "sinon";
import { expect } from "chai";

import { config } from "@chainsafe/eth2.0-config/lib/presets/mainnet";
import * as blockBodyAssembly from "../../../../../src/chain/factory/block/body";
import * as blockTransitions from "@chainsafe/eth2.0-state-transition";
import { OpPool } from "../../../../../src/opPool";
import { assembleBlock } from "../../../../../src/chain/factory/block";
import { EthersEth1Notifier } from "../../../../../src/eth1";
import { generateState } from "../../../../utils/state";
import { StatefulDagLMDGHOST } from "../../../../../../lodestar/src/chain/forkChoice";
import { BeaconChain } from "../../../../../src/chain";
import { generateEmptyBlock, generateEmptySignedBlock } from "../../../../utils/block";
import { BlockRepository, DepositDataRootListRepository, StateRepository } from "../../../../../src/db/api/beacon/repositories";

describe("block assembly", function () {

  const sandbox = sinon.createSandbox();

  let assembleBodyStub: any, chainStub: any, forkChoiceStub: any, stateTransitionStub: any, opPool: any, beaconDB: any, eth1: any;

  beforeEach(() => {
    assembleBodyStub = sandbox.stub(blockBodyAssembly, "assembleBody");
    stateTransitionStub = sandbox.stub(blockTransitions, "stateTransition");


    forkChoiceStub = sandbox.createStubInstance(StatefulDagLMDGHOST);
    chainStub = sandbox.createStubInstance(BeaconChain);
    chainStub.forkChoice = forkChoiceStub;

    opPool = sandbox.createStubInstance(OpPool);
    beaconDB = {
      block: sandbox.createStubInstance(BlockRepository),
      state: sandbox.createStubInstance(StateRepository),
      depositDataRootList: sandbox.createStubInstance(DepositDataRootListRepository)
    };
    eth1 = sandbox.createStubInstance(EthersEth1Notifier);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should assemble block", async function () {
    const head = chainStub.forkChoice.head();
    beaconDB.block.get.withArgs(head).returns(generateEmptySignedBlock());
    beaconDB.state.get.resolves(generateState({ slot: 1 }));
    beaconDB.depositDataRootList.getSerialized.resolves(config.types.DepositDataRootList.tree.defaultValue().serialize());
    assembleBodyStub.resolves(generateEmptyBlock().body);
    stateTransitionStub.returns(generateState());
    try {
      const result = await assembleBlock(config, chainStub, beaconDB, opPool, eth1, 1, Buffer.alloc(96, 0));
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
