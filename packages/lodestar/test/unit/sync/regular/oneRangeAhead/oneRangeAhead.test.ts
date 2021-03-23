import {SinonStubbedInstance} from "sinon";
import {ORARegularSync} from "../../../../../src/sync/regular/oneRangeAhead/oneRangeAhead";
import {IBlockRangeFetcher} from "../../../../../src/sync/regular/oneRangeAhead/interface";
import {BlockRangeFetcher} from "../../../../../src/sync/regular/oneRangeAhead/fetcher";
import sinon from "sinon";
import {config} from "@chainsafe/lodestar-config/minimal";
import {BeaconChain, ChainEventEmitter, ForkChoice, IBeaconChain} from "../../../../../src/chain";
import {INetwork, Network} from "../../../../../src/network";
import {testLogger} from "../../../../utils/logger";
import {generateBlockSummary, generateEmptySignedBlock} from "../../../../utils/block";
import {expect} from "chai";
import {Eth2Gossipsub} from "../../../../../src/network/gossip";
import {IBeaconClock, LocalClock} from "../../../../../src/chain/clock";
import * as slotUtils from "@chainsafe/lodestar-beacon-state-transition/lib/util/slot";
import {sleep} from "@chainsafe/lodestar-cli/src/util";
import {phase0} from "@chainsafe/lodestar-types";
import {SinonStubFn} from "../../../../utils/types";

describe("ORARegularSync", function () {
  let sync: ORARegularSync;
  let fetcherStub: SinonStubbedInstance<IBlockRangeFetcher>;
  let chainStub: SinonStubbedInstance<IBeaconChain>;
  let clockStub: SinonStubbedInstance<IBeaconClock>;
  let forkChoiceStub: SinonStubbedInstance<ForkChoice>;
  let networkStub: SinonStubbedInstance<INetwork>;
  let gossipStub: SinonStubbedInstance<Eth2Gossipsub>;
  let getCurrentSlotStub: SinonStubFn<typeof slotUtils["getCurrentSlot"]>;
  const logger = testLogger("ORARegularSync");

  beforeEach(() => {
    forkChoiceStub = sinon.createStubInstance(ForkChoice);
    chainStub = sinon.createStubInstance(BeaconChain);
    chainStub.forkChoice = forkChoiceStub;
    chainStub.emitter = new ChainEventEmitter();
    clockStub = sinon.createStubInstance(LocalClock);
    chainStub.clock = clockStub;
    networkStub = sinon.createStubInstance(Network);
    gossipStub = sinon.createStubInstance(Eth2Gossipsub);
    networkStub.gossip = (gossipStub as unknown) as Eth2Gossipsub;
    fetcherStub = sinon.createStubInstance(BlockRangeFetcher);
    sync = new ORARegularSync(
      {},
      {
        chain: chainStub,
        network: networkStub,
        logger,
        config,
        fetcher: fetcherStub,
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
      async (): Promise<phase0.SignedBeaconBlock[]> => {
        await sleep(200);
        logger.info("Fetched slot " + slot);
        const block = generateEmptySignedBlock();
        block.message.slot = slot++;
        return [block];
      }
    );
    chainStub.processChainSegment.callsFake(
      async (blocks: phase0.SignedBeaconBlock[]): Promise<void> => {
        await sleep(200);
        logger.info("Processed until slot " + blocks[blocks.length - 1].message.slot);
      }
    );
    getCurrentSlotStub.returns(2000);
    await Promise.all([
      new Promise<void>((resolve) => {
        setTimeout(async () => {
          logger.info("Stopping from unit test...");
          sync.stop();
          // one more round
          await sleep(200);
          resolve();
        }, 1000);
      }),
      sync.start(),
    ]);
    const fetchCount = fetcherStub.getNextBlockRange.callCount;
    const processCount = chainStub.processChainSegment.callCount;
    expect(fetchCount).to.be.greaterThan(1);
    expect(processCount).to.be.greaterThan(1);
    expect(fetchCount).to.be.equal(processCount + 1);
  });
});
