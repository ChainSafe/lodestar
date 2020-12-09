import {expect} from "chai";
import sinon, {SinonStubbedInstance} from "sinon";

import {config} from "@chainsafe/lodestar-config/minimal";
import {ForkChoice} from "@chainsafe/lodestar-fork-choice";

import {ChainEventEmitter} from "../../../../src/chain";
import {BlockErrorCode} from "../../../../src/chain/errors";
import {processBlock} from "../../../../src/chain/blocks/process";
import {RegenError, RegenErrorCode, StateRegenerator} from "../../../../src/chain/regen";
import {StubbedBeaconDb} from "../../../utils/stub";
import {getNewBlockJob} from "../../../utils/block";

describe("processBlock", function () {
  const emitter = new ChainEventEmitter();
  let forkChoice: SinonStubbedInstance<ForkChoice>;
  let dbStub: StubbedBeaconDb;
  let regen: SinonStubbedInstance<StateRegenerator>;

  beforeEach(function () {
    forkChoice = sinon.createStubInstance(ForkChoice);
    dbStub = new StubbedBeaconDb(sinon);
    regen = sinon.createStubInstance(StateRegenerator);
  });

  afterEach(function () {
    sinon.restore();
  });

  it("should throw on missing prestate", async function () {
    const signedBlock = config.types.SignedBeaconBlock.defaultValue();
    signedBlock.message.slot = 1;
    const job = getNewBlockJob(signedBlock);
    regen.getPreState.rejects(new RegenError({code: RegenErrorCode.ERR_STATE_TRANSITION_ERROR, error: new Error()}));
    try {
      await processBlock({
        forkChoice,
        db: dbStub,
        regen,
        emitter,
        job,
      });
      expect.fail("block should throw");
    } catch (e) {
      expect(e.type.code).to.equal(BlockErrorCode.ERR_PRESTATE_MISSING);
    }
  });
});
