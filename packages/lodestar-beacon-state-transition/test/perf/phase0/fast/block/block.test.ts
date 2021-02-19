import {config} from "@chainsafe/lodestar-config/mainnet";
import {SignedBeaconBlock, SignedVoluntaryExit} from "@chainsafe/lodestar-types";
import {WinstonLogger} from "@chainsafe/lodestar-utils";
import {List} from "@chainsafe/ssz";
import {expect} from "chai";
import {generatePerformanceBlock, generatePerformanceState, initBLS} from "../../../util";
import {phase0} from "../../../../../src";

describe("Process Blocks Performance Test", function () {
  this.timeout(0);
  let stateCtx: phase0.fast.IStateContext;
  const logger = new WinstonLogger();
  before(async () => {
    await initBLS();
    const origState = await generatePerformanceState();
    const epochCtx = new phase0.fast.EpochContext(config);
    epochCtx.loadState(origState);
    stateCtx = {state: phase0.fast.createCachedValidatorsBeaconState(origState), epochCtx};
  });

  it("should process block", async () => {
    const signedBlock = await generatePerformanceBlock();
    logger.profile(`Process block ${signedBlock.message.slot}`);
    const start = Date.now();
    phase0.fast.fastStateTransition(stateCtx, signedBlock, {
      verifyProposer: false,
      verifySignatures: false,
      verifyStateRoot: false,
    });
    expect(Date.now() - start).lte(25);
    logger.profile(`Process block ${signedBlock.message.slot}`);
  });

  it("should process multiple validator exits in same block", async () => {
    const signedBlock: SignedBeaconBlock = await generatePerformanceBlock();
    const exitEpoch = stateCtx.epochCtx.currentShuffling.epoch;
    const voluntaryExits: SignedVoluntaryExit[] = [];
    const numValidatorExits = config.params.MAX_VOLUNTARY_EXITS;
    for (let i = 0; i < numValidatorExits; i++) {
      voluntaryExits.push({
        message: {epoch: exitEpoch, validatorIndex: 40000 + i},
        signature: Buffer.alloc(96),
      });
    }
    signedBlock.message.body.voluntaryExits = (voluntaryExits as unknown) as List<SignedVoluntaryExit>;
    const start = Date.now();
    logger.profile(`Process block ${signedBlock.message.slot} with ${numValidatorExits} validator exits`);
    phase0.fast.fastStateTransition(stateCtx, signedBlock, {
      verifyProposer: false,
      verifySignatures: false,
      verifyStateRoot: false,
    });
    expect(Date.now() - start).lt(200);
    logger.profile(`Process block ${signedBlock.message.slot} with ${numValidatorExits} validator exits`);
  });
});
