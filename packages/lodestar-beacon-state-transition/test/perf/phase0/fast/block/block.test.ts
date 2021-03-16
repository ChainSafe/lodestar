import {config} from "@chainsafe/lodestar-config/mainnet";
import {List} from "@chainsafe/ssz";
import {expect} from "chai";
import {generatePerformanceBlock, generatePerformanceState, initBLS} from "../../../util";
import {phase0} from "../../../../../src";
import {profilerLogger} from "../../../../utils/logger";

describe("Process Blocks Performance Test", function () {
  this.timeout(0);
  let state: phase0.fast.CachedBeaconState<phase0.BeaconState>;
  const logger = profilerLogger();
  before(async () => {
    await initBLS();
    const origState = await generatePerformanceState();
    state = phase0.fast.createCachedBeaconState(config, origState);
  });

  it("should process block", async () => {
    const signedBlock = await generatePerformanceBlock();
    logger.profile(`Process block ${signedBlock.message.slot}`);
    const start = Date.now();
    phase0.fast.fastStateTransition(state, signedBlock, {
      verifyProposer: false,
      verifySignatures: false,
      verifyStateRoot: false,
    });
    expect(Date.now() - start).lte(25);
    logger.profile(`Process block ${signedBlock.message.slot}`);
  });

  it("should process multiple validator exits in same block", async () => {
    const signedBlock: phase0.SignedBeaconBlock = await generatePerformanceBlock();
    const exitEpoch = state.epochCtx.currentShuffling.epoch;
    const voluntaryExits: phase0.SignedVoluntaryExit[] = [];
    const numValidatorExits = config.params.MAX_VOLUNTARY_EXITS;
    for (let i = 0; i < numValidatorExits; i++) {
      voluntaryExits.push({
        message: {epoch: exitEpoch, validatorIndex: 40000 + i},
        signature: Buffer.alloc(96),
      });
    }
    signedBlock.message.body.voluntaryExits = (voluntaryExits as unknown) as List<phase0.SignedVoluntaryExit>;
    const start = Date.now();
    logger.profile(`Process block ${signedBlock.message.slot} with ${numValidatorExits} validator exits`);
    phase0.fast.fastStateTransition(state, signedBlock, {
      verifyProposer: false,
      verifySignatures: false,
      verifyStateRoot: false,
    });
    expect(Date.now() - start).lt(200);
    logger.profile(`Process block ${signedBlock.message.slot} with ${numValidatorExits} validator exits`);
  });
});
