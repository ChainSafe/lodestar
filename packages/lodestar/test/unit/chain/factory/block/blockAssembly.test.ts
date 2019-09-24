import sinon from "sinon";
import {expect} from "chai";

import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";
import * as blockBodyAssembly from "../../../../../src/chain/factory/block/body";
import * as blockTransitions from "../../../../../src/chain/stateTransition/block";
import {OpPool} from "../../../../../src/opPool";
import {assembleBlock} from "../../../../../src/chain/factory/block";
import {EthersEth1Notifier} from "../../../../../src/eth1";
import {generateState} from "../../../../utils/state";
import {generateEmptyBlock} from "../../../../utils/block";
import {BlockRepository, MerkleTreeRepository, StateRepository} from "../../../../../src/db/api/beacon/repositories";
import {ProgressiveMerkleTree} from "@chainsafe/eth2.0-utils";
import {MerkleTreeSerialization} from "../../../../../src/util/serialization";

describe("block assembly", function () {

  const sandbox = sinon.createSandbox();

  let assembleBodyStub, processBlockStub, opPool, beaconDB, eth1;

  beforeEach(() => {
    assembleBodyStub = sandbox.stub(blockBodyAssembly, "assembleBody");
    processBlockStub = sandbox.stub(blockTransitions, "processBlock");
    opPool = sandbox.createStubInstance(OpPool);
    beaconDB = {
      block: sandbox.createStubInstance(BlockRepository),
      state: sandbox.createStubInstance(StateRepository),
      merkleTree: sandbox.createStubInstance(MerkleTreeRepository)
    };
    eth1 = sandbox.createStubInstance(EthersEth1Notifier);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should assemble block", async function() {
    beaconDB.state.getLatest.resolves(generateState({slot: 1}));
    beaconDB.block.getChainHead.resolves(generateEmptyBlock());
    beaconDB.merkleTree.getProgressiveMerkleTree.resolves(
      ProgressiveMerkleTree.empty(32, new MerkleTreeSerialization(config))
    );
    assembleBodyStub.resolves(generateEmptyBlock().body);
    try {
      const result = await assembleBlock(config, beaconDB, opPool, eth1, 1, Buffer.alloc(96, 0));
      expect(result).to.not.be.null;
      expect(result.slot).to.equal(1);
      expect(result.stateRoot).to.not.be.null;
      expect(result.parentRoot).to.not.be.null;
      expect(beaconDB.state.getLatest.calledOnce).to.be.true;
      expect(beaconDB.block.getChainHead.calledOnce).to.be.true;
      expect(assembleBodyStub.calledOnce).to.be.true;
      expect(processBlockStub.withArgs(sinon.match.any, sinon.match.any).calledOnce).to.be.true;
    } catch (e) {
      expect.fail(e.stack);
    }
  });
});
