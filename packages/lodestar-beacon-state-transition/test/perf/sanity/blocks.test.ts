import {initBLS} from "@chainsafe/bls";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {SignedBeaconBlock, SignedVoluntaryExit, VoluntaryExit} from "@chainsafe/lodestar-types";
import {WinstonLogger} from "@chainsafe/lodestar-utils";
import {List} from "@chainsafe/ssz";
import {expect} from "chai";
import {EpochContext, fastStateTransition, IStateContext} from "../../../src/fast";
import {loadPerformanceBlock, loadPerformanceState} from "../util";

describe.only("Process Blocks Performance Test", function () {
  this.timeout(0);
  let stateCtx: IStateContext;
  const logger = new WinstonLogger();
  before(async () => {
    await initBLS();
    const state = await loadPerformanceState();
    const epochCtx = new EpochContext(config);
    epochCtx.loadState(state);
    stateCtx = {state, epochCtx};
  });

  it("should process block", async () => {
    const signedBlock = await loadPerformanceBlock();
    logger.profile(`Process block ${signedBlock.message.slot}`);
    const start = Date.now();
    fastStateTransition(stateCtx, signedBlock, {
      verifyProposer: false,
      verifySignatures: false,
      verifyStateRoot: false,
    });
    expect(Date.now() - start).lt(25);
    logger.profile(`Process block ${signedBlock.message.slot}`);
  });

  it("should process multiple validator exits in same block", async () => {
    const signedBlock: SignedBeaconBlock = await loadPerformanceBlock();
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
    fastStateTransition(stateCtx, signedBlock, {
      verifyProposer: false,
      verifySignatures: false,
      verifyStateRoot: false,
    });
    expect(Date.now() - start).lt(4800);
    logger.profile(`Process block ${signedBlock.message.slot} with ${numValidatorExits} validator exits`);
  });
});
