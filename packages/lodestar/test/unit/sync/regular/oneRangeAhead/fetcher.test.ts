import {expect} from "chai";
import sinon, {SinonFakeTimers, SinonStub, SinonStubbedInstance} from "sinon";
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
import {IPeerMetadataStore, Libp2pPeerMetadataStore} from "../../../../../src/network/peers";
import {Status} from "@chainsafe/lodestar-types";

describe("BlockRangeFetcher", function () {
  let fetcher: BlockRangeFetcher;
  let chainStub: SinonStubbedInstance<IBeaconChain>;
  let clockStub: SinonStubbedInstance<IBeaconClock>;
  let networkStub: SinonStubbedInstance<INetwork>;
  let metadataStub: SinonStubbedInstance<IPeerMetadataStore>;
  let getBlockRangeStub: SinonStub;
  let getCurrentSlotStub: SinonStub;
  const getPeers = async (): Promise<PeerId[]> => {
    return [await PeerId.create()];
  };
  const logger = new WinstonLogger();
  const sandbox = sinon.createSandbox();

  beforeEach(() => {
    sandbox.useFakeTimers();
    getBlockRangeStub = sandbox.stub(blockUtils, "getBlockRange");
    getCurrentSlotStub = sandbox.stub(slotUtils, "getCurrentSlot");
    chainStub = sandbox.createStubInstance(BeaconChain);
    clockStub = sandbox.createStubInstance(LocalClock);
    chainStub.clock = clockStub;
    networkStub = sandbox.createStubInstance(Libp2pNetwork);
    metadataStub = sandbox.createStubInstance(Libp2pPeerMetadataStore);
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
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should fetch next range initially", async () => {
    fetcher.setLastProcessedBlock({blockRoot: ZERO_HASH, slot: 1000});
    getCurrentSlotStub.returns(2000);
    const firstBlock = generateEmptySignedBlock();
    const secondBlock = generateEmptySignedBlock();
    secondBlock.message.slot = 2;
    secondBlock.message.parentRoot = config.types.BeaconBlock.hashTreeRoot(firstBlock.message);
    getBlockRangeStub.resolves([firstBlock, secondBlock]);
    await fetcher.getNextBlockRange();
    expect(getBlockRangeStub.calledOnceWith(logger, sinon.match.any, sinon.match.any, {start: 1001, end: 1066})).to.be
      .true;
  });

  it("should fetch next range based on last fetch block", async () => {
    // handle the case when peer does not return all blocks
    // next fetch should start from last fetch block
    fetcher.setLastProcessedBlock({blockRoot: ZERO_HASH, slot: 1000});
    getCurrentSlotStub.returns(2000);
    const firstBlock = generateEmptySignedBlock();
    firstBlock.message.slot = 1010;
    const secondBlock = generateEmptySignedBlock();
    secondBlock.message.slot = 1020;
    secondBlock.message.parentRoot = config.types.BeaconBlock.hashTreeRoot(firstBlock.message);
    const thirdBlock = generateEmptySignedBlock();
    thirdBlock.message.slot = 1030;
    thirdBlock.message.parentRoot = config.types.BeaconBlock.hashTreeRoot(secondBlock.message);
    getBlockRangeStub.onFirstCall().resolves([firstBlock, secondBlock]);
    getBlockRangeStub.onSecondCall().resolves([secondBlock, thirdBlock]);
    let result = await fetcher.getNextBlockRange();
    expect(getBlockRangeStub.calledOnceWith(logger, sinon.match.any, sinon.match.any, {start: 1001, end: 1066})).to.be
      .true;
    expect(result).to.be.deep.equal([firstBlock]);
    result = await fetcher.getNextBlockRange();
    expect(getBlockRangeStub.lastCall.calledWith(logger, sinon.match.any, sinon.match.any, {start: 1011, end: 1076})).to
      .be.true;
    expect(result).to.be.deep.equal([secondBlock]);
  });

  it("should handle getBlockRange error", async () => {
    fetcher.setLastProcessedBlock({blockRoot: ZERO_HASH, slot: 1000});
    getCurrentSlotStub.returns(2000);
    getBlockRangeStub.onFirstCall().throws("");
    const firstBlock = generateEmptySignedBlock();
    firstBlock.message.slot = 1010;
    const secondBlock = generateEmptySignedBlock();
    secondBlock.message.slot = 1020;
    secondBlock.message.parentRoot = config.types.BeaconBlock.hashTreeRoot(firstBlock.message);
    getBlockRangeStub.onSecondCall().resolves([firstBlock, secondBlock]);
    const result = await fetcher.getNextBlockRange();
    expect(getBlockRangeStub.calledWith(logger, sinon.match.any, sinon.match.any, {start: 1001, end: 1066})).to.be.true;
    expect(getBlockRangeStub.calledTwice).to.be.true;
    // second block is ignored since we can't validate if it's orphaned block or not
    expect(result).to.be.deep.equal([firstBlock]);
  });

  it("should handle getBlockRange returning null", async () => {
    fetcher.setLastProcessedBlock({blockRoot: ZERO_HASH, slot: 1000});
    getCurrentSlotStub.returns(2000);
    getBlockRangeStub.onFirstCall().resolves(null);
    const firstBlock = generateEmptySignedBlock();
    firstBlock.message.slot = 1010;
    const secondBlock = generateEmptySignedBlock();
    secondBlock.message.slot = 1020;
    secondBlock.message.parentRoot = config.types.BeaconBlock.hashTreeRoot(firstBlock.message);
    getBlockRangeStub.onSecondCall().resolves([firstBlock, secondBlock]);
    const result = await fetcher.getNextBlockRange();
    expect(getBlockRangeStub.calledWith(logger, sinon.match.any, sinon.match.any, {start: 1001, end: 1066})).to.be.true;
    expect(getBlockRangeStub.calledTwice).to.be.true;
    // second block is ignored since we can't validate if it's orphaned block or not
    expect(result).to.be.deep.equal([firstBlock]);
  });

  it("should handle getBlockRange returning no block", async () => {
    // fetcher should not trust a getBlockRange returning empty array using handleEmptyRange
    fetcher.setLastProcessedBlock({blockRoot: ZERO_HASH, slot: 1000});
    getCurrentSlotStub.returns(2000);
    getBlockRangeStub.onFirstCall().resolves([]);
    const firstBlock = generateEmptySignedBlock();
    firstBlock.message.slot = 1010;
    const secondBlock = generateEmptySignedBlock();
    secondBlock.message.slot = 1011;
    secondBlock.message.parentRoot = config.types.BeaconBlock.hashTreeRoot(firstBlock.message);
    getBlockRangeStub.onSecondCall().resolves([firstBlock, secondBlock]);
    metadataStub.getStatus.returns({headSlot: 3000} as Status);
    const result = await fetcher.getNextBlockRange();
    // second block is ignored since we can't validate if it's orphaned block or not
    expect(result).to.be.deep.equal([firstBlock]);
    expect(getBlockRangeStub.calledWith(logger, sinon.match.any, sinon.match.any, {start: 1001, end: 1066})).to.be.true;
    // same start, expand end
    expect(getBlockRangeStub.calledWith(logger, sinon.match.any, sinon.match.any, {start: 1001, end: 1131})).to.be.true;
    expect(getBlockRangeStub.calledTwice).to.be.true;
  });

  it("should handle getBlockRange timeout", async () => {
    const firstBlock = generateEmptySignedBlock();
    firstBlock.message.slot = 1010;
    const secondBlock = generateEmptySignedBlock();
    secondBlock.message.slot = 1011;
    secondBlock.message.parentRoot = config.types.BeaconBlock.hashTreeRoot(firstBlock.message);
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
  });

  it("should handle non-linear chain segment", async () => {
    fetcher.setLastProcessedBlock({blockRoot: ZERO_HASH, slot: 1000});
    getCurrentSlotStub.returns(2000);
    // first call returns non-linear chain
    getBlockRangeStub.onFirstCall().resolves([generateEmptySignedBlock(), generateEmptySignedBlock()]);
    const firstBlock = generateEmptySignedBlock();
    firstBlock.message.slot = 1010;
    const secondBlock = generateEmptySignedBlock();
    secondBlock.message.slot = 1011;
    secondBlock.message.parentRoot = config.types.BeaconBlock.hashTreeRoot(firstBlock.message);
    // second call returns linear chain
    getBlockRangeStub.onSecondCall().resolves([firstBlock, secondBlock]);
    const result = await fetcher.getNextBlockRange();
    // 2nd block is not validated so it's not returned
    expect(result).to.be.deep.equal([firstBlock]);
    expect(getBlockRangeStub.calledTwice).to.be.true;
    expect(getBlockRangeStub.alwaysCalledWith(logger, sinon.match.any, sinon.match.any, {start: 1001, end: 1066})).to.be
      .true;
  });
});
