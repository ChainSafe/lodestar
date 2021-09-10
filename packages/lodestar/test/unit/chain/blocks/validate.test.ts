import sinon, {SinonStubbedInstance} from "sinon";

import {config} from "@chainsafe/lodestar-config/default";
import {ForkChoice} from "@chainsafe/lodestar-fork-choice";

import {validateBlock} from "../../../../src/chain/blocks/validate";
import {LocalClock} from "../../../../src/chain/clock";
import {BlockErrorCode} from "../../../../src/chain/errors";
import {getNewBlockJob} from "../../../utils/block";
import {ssz} from "@chainsafe/lodestar-types";
import {expectThrowsLodestarError} from "../../../utils/errors";

describe("validateBlock", function () {
  let forkChoice: SinonStubbedInstance<ForkChoice>;
  let clock: SinonStubbedInstance<LocalClock>;

  beforeEach(function () {
    forkChoice = sinon.createStubInstance(ForkChoice);
    clock = sinon.createStubInstance(LocalClock);
  });

  afterEach(function () {
    sinon.restore();
  });

  it("GENESIS_BLOCK", function () {
    const signedBlock = ssz.phase0.SignedBeaconBlock.defaultValue();
    const job = getNewBlockJob(signedBlock);

    expectThrowsLodestarError(() => validateBlock({config, forkChoice, clock}, job), BlockErrorCode.GENESIS_BLOCK);
  });

  it("ALREADY_KNOWN", function () {
    const signedBlock = ssz.phase0.SignedBeaconBlock.defaultValue();
    signedBlock.message.slot = 1;
    const job = getNewBlockJob(signedBlock);
    forkChoice.hasBlockHex.returns(true);

    expectThrowsLodestarError(() => validateBlock({config, forkChoice, clock}, job), BlockErrorCode.ALREADY_KNOWN);
  });

  it("WOULD_REVERT_FINALIZED_SLOT", function () {
    const signedBlock = ssz.phase0.SignedBeaconBlock.defaultValue();
    signedBlock.message.slot = 1;
    const job = getNewBlockJob(signedBlock);
    forkChoice.hasBlock.returns(false);
    forkChoice.getFinalizedCheckpoint.returns({epoch: 5, root: Buffer.alloc(32), rootHex: ""});

    expectThrowsLodestarError(
      () => validateBlock({config, forkChoice, clock}, job),
      BlockErrorCode.WOULD_REVERT_FINALIZED_SLOT
    );
  });

  it("FUTURE_SLOT", function () {
    const signedBlock = ssz.phase0.SignedBeaconBlock.defaultValue();
    signedBlock.message.slot = 1;
    const job = getNewBlockJob(signedBlock);
    forkChoice.hasBlock.returns(false);
    forkChoice.getFinalizedCheckpoint.returns({epoch: 0, root: Buffer.alloc(32), rootHex: ""});
    sinon.stub(clock, "currentSlot").get(() => 0);

    expectThrowsLodestarError(() => validateBlock({config, forkChoice, clock}, job), BlockErrorCode.FUTURE_SLOT);
  });
});
