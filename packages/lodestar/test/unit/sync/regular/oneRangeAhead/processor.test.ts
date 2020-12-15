import {SinonStubbedInstance} from "sinon";
import {BlockRangeProcessor} from "../../../../../src/sync/regular/oneRangeAhead/processor";
import {BeaconChain, ChainEvent, ChainEventEmitter, IBeaconChain, IBlockJob} from "../../../../../src/chain";
import {config} from "@chainsafe/lodestar-config/minimal";
import sinon from "sinon";
import {WinstonLogger} from "@chainsafe/lodestar-utils";
import {generateEmptySignedBlock} from "../../../../utils/block";
import {AbortController} from "abort-controller";
import {ITreeStateContext} from "../../../../../src/db/api/beacon/stateContextCache";
import {BlockError, BlockErrorCode} from "../../../../../src/chain/errors";

describe("BlockRangeProcessor", function () {
  let processor: BlockRangeProcessor;
  let chainStub: SinonStubbedInstance<IBeaconChain>;
  const logger = new WinstonLogger();
  const firstBlock = generateEmptySignedBlock();
  firstBlock.message.slot = 1010;
  const secondBlock = generateEmptySignedBlock();
  secondBlock.message.slot = 1020;
  const abortController = new AbortController();

  beforeEach(async () => {
    chainStub = sinon.createStubInstance(BeaconChain);
    chainStub.emitter = new ChainEventEmitter();
    processor = new BlockRangeProcessor({
      config,
      chain: chainStub,
      logger,
    });
    await processor.start();
  });

  afterEach(async () => {
    await processor.stop();
    sinon.restore();
  });

  it("should process blocks based on block event", async () => {
    await Promise.all([
      processor.processUntilComplete([firstBlock, secondBlock], abortController.signal),
      chainStub.emitter.emit(ChainEvent.block, secondBlock, {} as ITreeStateContext, {} as IBlockJob),
    ]);
  });

  it("should process blocks based on block:error ERR_BLOCK_IS_ALREADY_KNOWN event", async () => {
    await Promise.all([
      processor.processUntilComplete([firstBlock, secondBlock], abortController.signal),
      chainStub.emitter.emit(
        ChainEvent.errorBlock,
        new BlockError({
          job: {signedBlock: secondBlock} as IBlockJob,
          code: BlockErrorCode.BLOCK_IS_ALREADY_KNOWN,
        })
      ),
    ]);
  });
});
