import {config} from "@chainsafe/lodestar-config/mainnet";
import {List, TreeBacked} from "@chainsafe/ssz";
import {allForks} from "@chainsafe/lodestar-types";
import {expect} from "chai";
import {generatePerformanceBlock, generatePerformanceState, initBLS} from "../../../util";
import {phase0, fast} from "../../../../../src";
import {profilerLogger} from "../../../../utils/logger";

describe("Process Blocks Performance Test", function () {
  this.timeout(0);
  let state: fast.CachedBeaconState<allForks.BeaconState>;
  const logger = profilerLogger();
  before(async () => {
    await initBLS();
    const origState = generatePerformanceState();
    state = fast.createCachedBeaconState(config, origState as TreeBacked<allForks.BeaconState>);
  });

  it("should process block", async () => {
    const signedBlock = generatePerformanceBlock();
    logger.profile(`Process block ${signedBlock.message.slot}`);
    const start = Date.now();
    fast.fastStateTransition(state, signedBlock, {
      verifyProposer: false,
      verifySignatures: false,
      verifyStateRoot: false,
    });
    expect(Date.now() - start).lte(25);
    logger.profile(`Process block ${signedBlock.message.slot}`);
  });

  it("should process multiple validator exits in same block", async () => {
    const signedBlock: phase0.SignedBeaconBlock = generatePerformanceBlock();
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
    fast.fastStateTransition(state, signedBlock, {
      verifyProposer: false,
      verifySignatures: false,
      verifyStateRoot: false,
    });
    expect(Date.now() - start).lt(200);
    logger.profile(`Process block ${signedBlock.message.slot} with ${numValidatorExits} validator exits`);
  });
});
