import sinon, {SinonStubbedInstance} from "sinon";

import {config} from "@chainsafe/lodestar-config/default";
import {ForkChoice, IProtoBlock} from "@chainsafe/lodestar-fork-choice";

import {verifyBlockSanityChecks, VerifyBlockModules} from "../../../../src/chain/blocks/verifyBlock";
import {LocalClock} from "../../../../src/chain/clock";
import {BlockErrorCode} from "../../../../src/chain/errors";
import {allForks, ssz} from "@chainsafe/lodestar-types";
import {expectThrowsLodestarError} from "../../../utils/errors";

describe("chain / blocks / verifyBlock", function () {
  let forkChoice: SinonStubbedInstance<ForkChoice>;
  let clock: LocalClock;
  let modules: VerifyBlockModules;
  let block: allForks.SignedBeaconBlock;
  const currentSlot = 1;

  beforeEach(function () {
    block = ssz.phase0.SignedBeaconBlock.defaultValue();
    block.message.slot = currentSlot;

    forkChoice = sinon.createStubInstance(ForkChoice);
    forkChoice.getFinalizedCheckpoint.returns({epoch: 0, root: Buffer.alloc(32), rootHex: ""});
    clock = {currentSlot} as LocalClock;
    modules = ({config, forkChoice, clock} as Partial<VerifyBlockModules>) as VerifyBlockModules;
    // On first call, parentRoot is known
    forkChoice.getBlockHex.returns({} as IProtoBlock);
  });

  it("PARENT_UNKNOWN", function () {
    forkChoice.getBlockHex.returns(null);
    expectThrowsLodestarError(() => verifyBlockSanityChecks(modules, {block}), BlockErrorCode.PARENT_UNKNOWN);
  });

  it("GENESIS_BLOCK", function () {
    block.message.slot = 0;
    expectThrowsLodestarError(() => verifyBlockSanityChecks(modules, {block}), BlockErrorCode.GENESIS_BLOCK);
  });

  it("ALREADY_KNOWN", function () {
    forkChoice.hasBlockHex.returns(true);
    expectThrowsLodestarError(() => verifyBlockSanityChecks(modules, {block}), BlockErrorCode.ALREADY_KNOWN);
  });

  it("WOULD_REVERT_FINALIZED_SLOT", function () {
    forkChoice.getFinalizedCheckpoint.returns({epoch: 5, root: Buffer.alloc(32), rootHex: ""});
    expectThrowsLodestarError(
      () => verifyBlockSanityChecks(modules, {block}),
      BlockErrorCode.WOULD_REVERT_FINALIZED_SLOT
    );
  });

  it("FUTURE_SLOT", function () {
    block.message.slot = currentSlot + 1;
    expectThrowsLodestarError(() => verifyBlockSanityChecks(modules, {block}), BlockErrorCode.FUTURE_SLOT);
  });
});
