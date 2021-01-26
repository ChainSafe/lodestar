import {config} from "@chainsafe/lodestar-config/mainnet";
import {BeaconState, SignedBeaconBlock, SignedVoluntaryExit} from "@chainsafe/lodestar-types";
import {WinstonLogger} from "@chainsafe/lodestar-utils";
import {List, TreeBacked} from "@chainsafe/ssz";
import {expect} from "chai";
import {fastStateTransition} from "../../../src/fast";
import {CachedBeaconState, createCachedBeaconState} from "../../../src/fast/util";
import {generatePerformanceBlock, generatePerformanceState, initBLS} from "../util";

describe("Process Blocks Performance Test", function () {
  this.timeout(0);
  const logger = new WinstonLogger();
  let cachedState: CachedBeaconState;
  let origState: TreeBacked<BeaconState>;

  before(async () => {
    await initBLS();
    origState = await generatePerformanceState();
  });

  beforeEach(() => {
    cachedState = createCachedBeaconState(config, origState.clone());
  });

  it("clone should be cheap", () => {
    const start = Date.now();
    for (let i = 0; i < 100; i++) cachedState.clone();
    expect(Date.now() - start).to.be.lte(1, "clone() takes longer than expected");
  });

  it("should process block", async () => {
    const signedBlock = await generatePerformanceBlock();
    logger.profile(`Process block ${signedBlock.message.slot}`);
    const start = Date.now();
    fastStateTransition(cachedState.clone(), signedBlock, {
      verifyProposer: false,
      verifySignatures: false,
      verifyStateRoot: false,
    });
    expect(Date.now() - start).lte(10, "processing block takes longer than expected");
    logger.profile(`Process block ${signedBlock.message.slot}`);
  });

  it("should process multiple validator exits in same block", async () => {
    const signedBlock: SignedBeaconBlock = await generatePerformanceBlock();
    const exitEpoch = cachedState.currentShuffling.epoch;
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
    fastStateTransition(cachedState.clone(), signedBlock, {
      verifyProposer: false,
      verifySignatures: false,
      verifyStateRoot: false,
    });
    expect(Date.now() - start).lt(200, "processing block with multiple validator exits takes longer than expected");
    logger.profile(`Process block ${signedBlock.message.slot} with ${numValidatorExits} validator exits`);
  });
});
