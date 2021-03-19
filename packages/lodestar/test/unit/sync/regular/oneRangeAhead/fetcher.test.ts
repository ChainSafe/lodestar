import {expect} from "chai";
import sinon, {SinonStub, SinonStubbedInstance} from "sinon";
import {config} from "@chainsafe/lodestar-config/minimal";
import {BlockRangeFetcher} from "../../../../../src/sync/regular/oneRangeAhead/fetcher";
import {BeaconChain, IBeaconChain} from "../../../../../src/chain";
import {INetwork, Network} from "../../../../../src/network";
import PeerId from "peer-id";
import * as blockUtils from "../../../../../src/sync/utils/blocks";
import * as slotUtils from "@chainsafe/lodestar-beacon-state-transition/lib/util/slot";
import {ZERO_HASH} from "../../../../../src/constants";
import {IBeaconClock, LocalClock} from "../../../../../src/chain/clock";
import {generateEmptySignedBlock} from "../../../../utils/block";
import {phase0} from "@chainsafe/lodestar-types";
import {getStubbedMetadataStore, StubbedIPeerMetadataStore} from "../../../../utils/peer";
import {testLogger} from "../../../../utils/logger";
import {SinonStubFn} from "../../../../utils/types";

describe("BlockRangeFetcher", function () {
  let fetcher: BlockRangeFetcher;
  let chainStub: SinonStubbedInstance<IBeaconChain>;
  let clockStub: SinonStubbedInstance<IBeaconClock>;
  let networkStub: SinonStubbedInstance<INetwork>;
  let metadataStub: StubbedIPeerMetadataStore;
  let getBlockRangeStub: SinonStubFn<typeof blockUtils["getBlockRange"]>;
  let getCurrentSlotStub: SinonStubFn<typeof slotUtils["getCurrentSlot"]>;
  const logger = testLogger();
  const sandbox = sinon.createSandbox();
  let getPeers: SinonStub;

  beforeEach(async () => {
    sandbox.useFakeTimers();
    getPeers = sandbox.stub();
    getBlockRangeStub = sandbox.stub(blockUtils, "getBlockRange");
    getCurrentSlotStub = sandbox.stub(slotUtils, "getCurrentSlot");
    chainStub = sandbox.createStubInstance(BeaconChain);
    clockStub = sandbox.createStubInstance(LocalClock);
    chainStub.clock = clockStub;
    networkStub = sandbox.createStubInstance(Network);
    metadataStub = getStubbedMetadataStore();
    networkStub.peerMetadata = metadataStub;
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
    getPeers.resolves([await PeerId.create()]);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should fetch next range initially", async () => {
    fetcher.setLastProcessedBlock({root: ZERO_HASH, slot: 1000});
    getCurrentSlotStub.returns(2000);
    const firstBlock = generateEmptySignedBlock();
    const secondBlock = generateEmptySignedBlock();
    secondBlock.message.slot = 2;
    secondBlock.message.parentRoot = config.types.phase0.BeaconBlock.hashTreeRoot(firstBlock.message);
    getBlockRangeStub.resolves([firstBlock, secondBlock]);
    await fetcher.getNextBlockRange();
    expect(getBlockRangeStub.calledOnceWith(logger, sinon.match.any, sinon.match.any, {start: 1000, end: 1065})).to.be
      .true;
  });

  it("should fetch next range based on last fetch block", async () => {
    // handle the case when peer does not return all blocks
    // next fetch should start from last fetch block
    fetcher.setLastProcessedBlock({root: ZERO_HASH, slot: 1000});
    getCurrentSlotStub.returns(2000);
    const firstBlock = generateEmptySignedBlock();
    firstBlock.message.slot = 1010;
    const secondBlock = generateEmptySignedBlock();
    secondBlock.message.slot = 1020;
    secondBlock.message.parentRoot = config.types.phase0.BeaconBlock.hashTreeRoot(firstBlock.message);
    const thirdBlock = generateEmptySignedBlock();
    thirdBlock.message.slot = 1030;
    thirdBlock.message.parentRoot = config.types.phase0.BeaconBlock.hashTreeRoot(secondBlock.message);
    getBlockRangeStub.onFirstCall().resolves([firstBlock, secondBlock]);
    getBlockRangeStub.onSecondCall().resolves([secondBlock, thirdBlock]);
    let result = await fetcher.getNextBlockRange();
    expect(getBlockRangeStub.calledOnceWith(logger, sinon.match.any, sinon.match.any, {start: 1000, end: 1065})).to.be
      .true;
    expect(result).to.be.deep.equal([firstBlock]);
    result = await fetcher.getNextBlockRange();
    expect(getBlockRangeStub.lastCall.calledWith(logger, sinon.match.any, sinon.match.any, {start: 1010, end: 1075})).to
      .be.true;
    expect(result).to.be.deep.equal([secondBlock]);
  });

  it("should handle getBlockRange error", async () => {
    // should switch peer
    const firstPeerId = await PeerId.create();
    getPeers.onFirstCall().resolves([firstPeerId]);
    fetcher.setLastProcessedBlock({root: ZERO_HASH, slot: 1000});
    getCurrentSlotStub.returns(2000);
    getBlockRangeStub.onFirstCall().throws("");
    const firstBlock = generateEmptySignedBlock();
    firstBlock.message.slot = 1010;
    const secondBlock = generateEmptySignedBlock();
    secondBlock.message.slot = 1020;
    secondBlock.message.parentRoot = config.types.phase0.BeaconBlock.hashTreeRoot(firstBlock.message);
    getBlockRangeStub.onSecondCall().resolves([firstBlock, secondBlock]);
    const result = await fetcher.getNextBlockRange();
    expect(getBlockRangeStub.calledWith(logger, sinon.match.any, sinon.match.any, {start: 1000, end: 1065})).to.be.true;
    expect(getBlockRangeStub.calledTwice).to.be.true;
    // second block is ignored since we can't validate if it's orphaned block or not
    expect(result).to.be.deep.equal([firstBlock]);
    expect(getPeers.calledWithExactly([firstPeerId.toB58String()])).to.be.true;
  });

  it("should handle getBlockRange returning no block or single block", async () => {
    // expect 2 things
    // switch peer since some weird peers keep returning 0 block or 1 block
    // same start, expand end
    const firstPeerId = await PeerId.create();
    getPeers.onFirstCall().resolves([firstPeerId]);
    const secondPeerId = await PeerId.create();
    getPeers.onSecondCall().resolves([secondPeerId]);
    // fetcher should not trust a getBlockRange returning empty array using handleEmptyRange
    fetcher.setLastProcessedBlock({root: ZERO_HASH, slot: 1000});
    getCurrentSlotStub.returns(2000);
    const firstBlock = generateEmptySignedBlock();
    firstBlock.message.slot = 1010;
    const secondBlock = generateEmptySignedBlock();
    secondBlock.message.slot = 1011;
    secondBlock.message.parentRoot = config.types.phase0.BeaconBlock.hashTreeRoot(firstBlock.message);
    getBlockRangeStub.onFirstCall().resolves([]);
    getBlockRangeStub.onSecondCall().resolves([firstBlock]);
    getBlockRangeStub.onThirdCall().resolves([firstBlock, secondBlock]);
    metadataStub.status.get.returns({headSlot: 3000} as phase0.Status);
    const result = await fetcher.getNextBlockRange();
    expect(getPeers.calledThrice).to.be.true;
    // should switch peer
    expect(getPeers.calledWithExactly([firstPeerId.toB58String()])).to.be.true;
    expect(getPeers.calledWithExactly([firstPeerId.toB58String(), secondPeerId.toB58String()])).to.be.true;
    // second block is ignored since we can't validate if it's orphaned block or not
    expect(result).to.be.deep.equal([firstBlock]);
    expect(getBlockRangeStub.calledWith(logger, sinon.match.any, sinon.match.any, {start: 1000, end: 1065})).to.be.true;
    // same start, expand end
    expect(getBlockRangeStub.calledWith(logger, sinon.match.any, sinon.match.any, {start: 1000, end: 1066})).to.be.true;
    expect(getBlockRangeStub.calledWith(logger, sinon.match.any, sinon.match.any, {start: 1000, end: 1067})).to.be.true;
    expect(getBlockRangeStub.calledThrice).to.be.true;
  });

  it("should handle getBlockRange returning 2 blocks, one of which is last fetched block", async () => {
    // some peers returns exactly 2 blocks, 1 is last fetched block and 1 more (orphaned)
    // we trim the last block to avoid orphaned block
    // expect handleEmptyRange scenario and switch peer in this case
    const firstPeerId = await PeerId.create();
    getPeers.onFirstCall().resolves([firstPeerId]);
    getCurrentSlotStub.returns(2000);
    const firstBlock = generateEmptySignedBlock();
    firstBlock.message.slot = 1000;
    fetcher.setLastProcessedBlock({root: config.types.phase0.BeaconBlock.hashTreeRoot(firstBlock.message), slot: 1000});
    const secondBlock = generateEmptySignedBlock();
    secondBlock.message.slot = 1001;
    secondBlock.message.parentRoot = config.types.phase0.BeaconBlock.hashTreeRoot(firstBlock.message);
    const thirdBlock = generateEmptySignedBlock();
    thirdBlock.message.slot = 1002;
    thirdBlock.message.parentRoot = config.types.phase0.BeaconBlock.hashTreeRoot(secondBlock.message);
    getBlockRangeStub.onFirstCall().resolves([firstBlock, secondBlock]);
    getBlockRangeStub.onSecondCall().resolves([firstBlock, secondBlock, thirdBlock]);
    metadataStub.status.get.returns({headSlot: 3000} as phase0.Status);
    const result = await fetcher.getNextBlockRange();
    expect(getPeers.calledTwice).to.be.true;
    // should switch peer
    expect(getPeers.calledWithExactly([firstPeerId.toB58String()])).to.be.true;
    // first block is ignored since it's last fetched block
    // third block is ignored since we trim it
    expect(result).to.be.deep.equal([secondBlock]);
    expect(getBlockRangeStub.calledWith(logger, sinon.match.any, sinon.match.any, {start: 1000, end: 1065})).to.be.true;
    // same start, expand end
    expect(getBlockRangeStub.calledWith(logger, sinon.match.any, sinon.match.any, {start: 1000, end: 1066})).to.be.true;
    expect(getBlockRangeStub.calledTwice).to.be.true;
  });

  it("should handle getBlockRange timeout", async () => {
    // should switch peer
    const firstPeerId = await PeerId.create();
    getPeers.onFirstCall().resolves([firstPeerId]);
    const firstBlock = generateEmptySignedBlock();
    firstBlock.message.slot = 1010;
    const secondBlock = generateEmptySignedBlock();
    secondBlock.message.slot = 1011;
    secondBlock.message.parentRoot = config.types.phase0.BeaconBlock.hashTreeRoot(firstBlock.message);
    // onFirstCall timeout
    getBlockRangeStub.onFirstCall().returns(
      new Promise((resolve) => {
        setTimeout(() => resolve([]), 4 * 60 * 1000);
      })
    );
    getBlockRangeStub.onSecondCall().resolves([firstBlock, secondBlock]);
    const triggerTimeout = async (): Promise<void> => {
      await getPeers();
      // want to run this after the getPeers() call inside getNextBlockRange()
      sandbox.clock.tick(3 * 60 * 1000);
    };
    await Promise.all([fetcher.getNextBlockRange(), triggerTimeout()]);
    expect(getBlockRangeStub.calledTwice).to.be.true;
    expect(getPeers.calledWithExactly([firstPeerId.toB58String()])).to.be.true;
  });

  it("should handle non-linear chain segment", async () => {
    // should switch peer or the sync will keep getting the same chain segment and be stale
    const firstPeerId = await PeerId.create();
    getPeers.onFirstCall().resolves([firstPeerId]);
    fetcher.setLastProcessedBlock({root: ZERO_HASH, slot: 1000});
    getCurrentSlotStub.returns(2000);
    // first call returns non-linear chain
    getBlockRangeStub.onFirstCall().resolves([generateEmptySignedBlock(), generateEmptySignedBlock()]);
    const firstBlock = generateEmptySignedBlock();
    firstBlock.message.slot = 1010;
    const secondBlock = generateEmptySignedBlock();
    secondBlock.message.slot = 1011;
    secondBlock.message.parentRoot = config.types.phase0.BeaconBlock.hashTreeRoot(firstBlock.message);
    // second call returns linear chain
    getBlockRangeStub.onSecondCall().resolves([firstBlock, secondBlock]);
    const result = await fetcher.getNextBlockRange();
    // 2nd block is not validated so it's not returned
    expect(result).to.be.deep.equal([firstBlock]);
    // should switch peer
    expect(getPeers.calledWithExactly([firstPeerId.toB58String()])).to.be.true;
    expect(getBlockRangeStub.calledTwice).to.be.true;
    expect(getBlockRangeStub.alwaysCalledWith(logger, sinon.match.any, sinon.match.any, {start: 1000, end: 1065})).to.be
      .true;
  });
});
