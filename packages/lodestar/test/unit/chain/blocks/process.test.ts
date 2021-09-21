import {expect} from "chai";
import {config} from "@chainsafe/lodestar-config/default";
import sinon, {SinonStubbedInstance} from "sinon";

import {ForkChoice} from "@chainsafe/lodestar-fork-choice";

import {ChainEventEmitter} from "../../../../src/chain";
import {BlockError, BlockErrorCode} from "../../../../src/chain/errors";
import {CheckpointStateCache} from "../../../../src/chain/stateCache";
import {processBlock} from "../../../../src/chain/blocks/process";
import {BlsSingleThreadVerifier} from "../../../../src/chain/bls";
import {RegenError, RegenErrorCode, StateRegenerator} from "../../../../src/chain/regen";
import {getNewBlockJob} from "../../../utils/block";
import {createStubInstance} from "../../../utils/types";
import {ssz} from "@chainsafe/lodestar-types";

describe("processBlock", function () {
  const emitter = new ChainEventEmitter();
  const metrics = null;
  let forkChoice: SinonStubbedInstance<ForkChoice>;
  let checkpointStateCache: SinonStubbedInstance<CheckpointStateCache> & CheckpointStateCache;
  let regen: SinonStubbedInstance<StateRegenerator>;
  let bls: SinonStubbedInstance<BlsSingleThreadVerifier>;
  const genesisTime = Math.floor(Date.now() / 1000);

  beforeEach(function () {
    forkChoice = sinon.createStubInstance(ForkChoice);
    checkpointStateCache = createStubInstance(CheckpointStateCache);
    regen = sinon.createStubInstance(StateRegenerator);
    bls = sinon.createStubInstance(BlsSingleThreadVerifier);
  });

  afterEach(function () {
    sinon.restore();
  });

  it("should throw on unknown parent", async function () {
    const signedBlock = ssz.phase0.SignedBeaconBlock.defaultValue();
    signedBlock.message.slot = 1;
    const job = getNewBlockJob(signedBlock);
    forkChoice.hasBlock.returns(false);
    try {
      await processBlock({config, forkChoice, checkpointStateCache, regen, emitter, bls, metrics}, job, genesisTime);
      expect.fail("block should throw");
    } catch (e) {
      expect((e as BlockError).type.code).to.equal(BlockErrorCode.PARENT_UNKNOWN);
    }
  });

  it("should throw on missing prestate", async function () {
    const signedBlock = ssz.phase0.SignedBeaconBlock.defaultValue();
    signedBlock.message.slot = 1;
    const job = getNewBlockJob(signedBlock);
    forkChoice.hasBlock.returns(true);
    regen.getPreState.rejects(new RegenError({code: RegenErrorCode.STATE_TRANSITION_ERROR, error: new Error()}));
    try {
      await processBlock({config, forkChoice, checkpointStateCache, regen, emitter, bls, metrics}, job, genesisTime);
      expect.fail("block should throw");
    } catch (e) {
      expect((e as BlockError).type.code).to.equal(BlockErrorCode.PRESTATE_MISSING);
    }
  });
});
