import {expect} from "chai";
import sinon, {SinonStub, SinonStubbedInstance} from "sinon";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {BlockRangeFetcher} from "../../../../../src/sync/regular/oneRangeAhead/fetcher";
import {BeaconChain, IBeaconChain} from "../../../../../src/chain";
import {INetwork, Libp2pNetwork} from "../../../../../src/network";
import {WinstonLogger} from "@chainsafe/lodestar-utils";
import PeerId from "peer-id";
import * as blockUtils from "../../../../../src/sync/utils/blocks";
import * as slotUtils from "@chainsafe/lodestar-beacon-state-transition/lib/util/slot";
import {ZERO_HASH} from "../../../../../src/constants";
import {IBeaconClock, LocalClock} from "../../../../../src/chain/clock";
import {generateEmptySignedBlock} from "../../../../utils/block";

describe("BlockRangeFetcher", function () {
  let fetcher: BlockRangeFetcher;
  let chainStub: SinonStubbedInstance<IBeaconChain>;
  let clockStub: SinonStubbedInstance<IBeaconClock>;
  let networkStub: SinonStubbedInstance<INetwork>;
  let getBlockRangeStub: SinonStub;
  let getCurrentSlotStub: SinonStub;
  const getPeers = async (): Promise<PeerId[]> => {
    return [await PeerId.create()];
  };
  const logger = new WinstonLogger();

  beforeEach(() => {
    getBlockRangeStub = sinon.stub(blockUtils, "getBlockRange");
    getCurrentSlotStub = sinon.stub(slotUtils, "getCurrentSlot");
    chainStub = sinon.createStubInstance(BeaconChain);
    clockStub = sinon.createStubInstance(LocalClock);
    chainStub.clock = clockStub;
    networkStub = sinon.createStubInstance(Libp2pNetwork);
    fetcher = new BlockRangeFetcher(
      {},
      {
        config,
        network: networkStub,
        chain: chainStub,
        logger,
      },
      getPeers
    );
  });

  afterEach(() => {
    sinon.restore();
  });

  it("should fetch next range initially", async () => {
    fetcher.setLastProcessedBlock({blockRoot: ZERO_HASH, slot: 1000});
    getCurrentSlotStub.returns(2000);
    getBlockRangeStub.resolves([generateEmptySignedBlock()]);
    await fetcher.next();
    expect(getBlockRangeStub.calledOnceWith(logger, sinon.match.any, sinon.match.any, {start: 1001, end: 1065}));
  });

  it("should fetch next range based on last fetch block", async () => {
    // handle the case when peer does not return all blocks
    // next fetch should start from last fetch block
    fetcher.setLastProcessedBlock({blockRoot: ZERO_HASH, slot: 1000});
    getCurrentSlotStub.returns(2000);
    const firstBlock = generateEmptySignedBlock();
    firstBlock.message.slot = 1010;
    getBlockRangeStub.onFirstCall().resolves([firstBlock]);
    const secondBlock = generateEmptySignedBlock();
    secondBlock.message.slot = 1020;
    getBlockRangeStub.onSecondCall().resolves([secondBlock]);
    await fetcher.next();
    expect(getBlockRangeStub.calledOnceWith(logger, sinon.match.any, sinon.match.any, {start: 1001, end: 1065}));
    await fetcher.next();
    expect(getBlockRangeStub.lastCall.calledWith(logger, sinon.match.any, sinon.match.any, {start: 1011, end: 1075}));
  });

  it("should handle getBlockRange error", async () => {
    fetcher.setLastProcessedBlock({blockRoot: ZERO_HASH, slot: 1000});
    getCurrentSlotStub.returns(2000);
    getBlockRangeStub.onFirstCall().throws("");
    const firstBlock = generateEmptySignedBlock();
    firstBlock.message.slot = 1010;
    getBlockRangeStub.onSecondCall().resolves([firstBlock]);
    await fetcher.next();
    expect(getBlockRangeStub.calledWith(logger, sinon.match.any, sinon.match.any, {start: 1001, end: 1065}));
    expect(getBlockRangeStub.calledTwice).to.be.true;
  });

  it("should handle getBlockRange returning null", async () => {
    fetcher.setLastProcessedBlock({blockRoot: ZERO_HASH, slot: 1000});
    getCurrentSlotStub.returns(2000);
    getBlockRangeStub.onFirstCall().resolves(null);
    const firstBlock = generateEmptySignedBlock();
    firstBlock.message.slot = 1010;
    getBlockRangeStub.onSecondCall().resolves([firstBlock]);
    await fetcher.next();
    expect(getBlockRangeStub.calledWith(logger, sinon.match.any, sinon.match.any, {start: 1001, end: 1065}));
    expect(getBlockRangeStub.calledTwice).to.be.true;
  });

  it("should handle getBlockRange returning no block", async () => {
    // fetcher should not trust a getBlockRange returning empty array using handleEmptyRange
    fetcher.setLastProcessedBlock({blockRoot: ZERO_HASH, slot: 1000});
    getCurrentSlotStub.returns(2000);
    getBlockRangeStub.onFirstCall().resolves([]);
    const firstBlock = generateEmptySignedBlock();
    firstBlock.message.slot = 1010;
    getBlockRangeStub.onSecondCall().resolves([firstBlock]);
    await fetcher.next();
    expect(getBlockRangeStub.calledOnceWith(logger, sinon.match.any, sinon.match.any, {start: 1001, end: 1065}));
    // same start, expand end
    expect(getBlockRangeStub.calledOnceWith(logger, sinon.match.any, sinon.match.any, {start: 1001, end: 1129}));
    expect(getBlockRangeStub.calledTwice).to.be.true;
  });
});
