import {SinonStub, SinonStubbedInstance} from "sinon";
import {ORARegularSync} from "../../../../../src/sync/regular/oneRangeAhead/oneRangeAhead";
import {IBlockRangeFetcher, IBlockRangeProcessor} from "../../../../../src/sync/regular/oneRangeAhead/interface";
import {BlockRangeFetcher} from "../../../../../src/sync/regular/oneRangeAhead/fetcher";
import sinon from "sinon";
import {BlockRangeProcessor} from "../../../../../src/sync/regular/oneRangeAhead/processor";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {BeaconChain, ChainEventEmitter, ForkChoice, IBeaconChain} from "../../../../../src/chain";
import {INetwork, Libp2pNetwork} from "../../../../../src/network";
import {WinstonLogger} from "@chainsafe/lodestar-utils";
import {generateBlockSummary, generateEmptySignedBlock} from "../../../../utils/block";
import {expect} from "chai";
import {IGossip} from "../../../../../src/network/gossip/interface";
import {Gossip} from "../../../../../src/network/gossip/gossip";
import {IBeaconClock, LocalClock} from "../../../../../src/chain/clock";
import * as slotUtils from "@chainsafe/lodestar-beacon-state-transition/lib/util/slot";
import {sleep} from "@chainsafe/lodestar-cli/src/util";
import {SignedBeaconBlock} from "@chainsafe/lodestar-types";
import {AbortSignal} from "abort-controller";

describe("ORARegularSync", function () {
  let sync: ORARegularSync;
  let fetcherStub: SinonStubbedInstance<IBlockRangeFetcher>;
  // let fetcherStub: IBlockRangeFetcher;
  let processorStub: SinonStubbedInstance<IBlockRangeProcessor>;
  let chainStub: SinonStubbedInstance<IBeaconChain>;
  let clockStub: SinonStubbedInstance<IBeaconClock>;
  let forkChoiceStub: SinonStubbedInstance<ForkChoice>;
  let networkStub: SinonStubbedInstance<INetwork>;
  let gossipStub: SinonStubbedInstance<IGossip>;
  let getCurrentSlotStub: SinonStub;
  const logger = new WinstonLogger({module: "ORARegularSync"});

  beforeEach(() => {
    forkChoiceStub = sinon.createStubInstance(ForkChoice);
    chainStub = sinon.createStubInstance(BeaconChain);
    chainStub.forkChoice = forkChoiceStub;
    chainStub.emitter = new ChainEventEmitter();
    clockStub = sinon.createStubInstance(LocalClock);
    chainStub.clock = clockStub;
    networkStub = sinon.createStubInstance(Libp2pNetwork);
    gossipStub = sinon.createStubInstance(Gossip);
    networkStub.gossip = gossipStub;
    fetcherStub = sinon.createStubInstance(BlockRangeFetcher);
    processorStub = sinon.createStubInstance(BlockRangeProcessor);
    sync = new ORARegularSync(
      {},
      {
        chain: chainStub,
        network: networkStub,
        logger,
        config,
        fetcher: fetcherStub,
        processor: processorStub,
      }
    );
    getCurrentSlotStub = sinon.stub(slotUtils, "getCurrentSlot");
  });

  afterEach(() => {
    sinon.restore();
  });

  it("should call fetcher.next and processor.processUntilComplete upon start", async () => {
    forkChoiceStub.getHead.returns(generateBlockSummary({slot: 1000}));
    let slot = 1000;
    fetcherStub.getNextBlockRange.callsFake(
      async (): Promise<SignedBeaconBlock[]> => {
        await sleep(200);
        logger.info("Fetched slot " + slot);
        const block = generateEmptySignedBlock();
        block.message.slot = slot++;
        return [block];
      }
    );
    processorStub.processUntilComplete.callsFake(
      async (blocks: SignedBeaconBlock[], signal: AbortSignal): Promise<void> => {
        if (!signal.aborted) {
          await sleep(200);
          logger.info("Processed until slot " + blocks[blocks.length - 1].message.slot);
        }
      }
    );
    getCurrentSlotStub.returns(2000);
    await Promise.all([
      new Promise((resolve) => {
        setTimeout(async () => {
          logger.info("Stopping from unit test...");
          await sync.stop();
          // one more round
          await sleep(200);
          resolve();
        }, 1000);
      }),
      sync.start(),
    ]);
    const fetchCount = fetcherStub.getNextBlockRange.callCount;
    const processCount = processorStub.processUntilComplete.callCount;
    expect(fetchCount).to.be.greaterThan(1);
    expect(processCount).to.be.greaterThan(1);
    expect(fetchCount).to.be.equal(processCount + 1);
  });
});
