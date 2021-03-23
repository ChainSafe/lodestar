import {initBLS} from "@chainsafe/lodestar-cli/src/util";
import {config} from "@chainsafe/lodestar-config/minimal";
import {expect} from "chai";
import sinon, {SinonStubbedInstance} from "sinon";
import {RpcResponseStatus} from "../../../../../src/constants";
import {
  handleBeaconBlocksByRange,
  isOverlappedRange,
  onBeaconBlocksByRange,
  shouldRetry,
  shouldWaitForBlockArchiver,
} from "../../../../../src/network/reqresp/handlers/beaconBlocksByRange";
import {ResponseError} from "../../../../../src/network/reqresp/response";
import {TasksService} from "../../../../../src/tasks";
import {IArchivingStatus, ITaskService} from "../../../../../src/tasks/interface";
import {generateEmptySignedBlock} from "../../../../utils/block";
import {StubbedBeaconChain, StubbedBeaconDb} from "../../../../utils/stub";

describe("shouldWaitForBlockArchiver", function () {
  const requestBody = {
    startSlot: 40,
    count: 30,
    step: 1,
  };
  const testCases: {desc: string; archiveStatus: IArchivingStatus; expected: boolean}[] = [
    {
      desc: "first check, BlockArchiver is not running",
      archiveStatus: {lastFinalizedSlot: 32, finalizingSlot: null},
      expected: false,
    },
    {
      desc: "first check, BlockArchiver is running at different range",
      archiveStatus: {lastFinalizedSlot: 1000, finalizingSlot: 1032},
      expected: false,
    },
    {
      desc: "first, BlockArchiver is running at overlappsed range",
      archiveStatus: {lastFinalizedSlot: 32, finalizingSlot: 64},
      expected: true,
    },
  ];
  for (const tc of testCases) {
    it(tc.desc, function () {
      expect(shouldWaitForBlockArchiver(requestBody, tc.archiveStatus)).to.be.equal(tc.expected);
    });
  }
  const testCases2: {
    desc: string;
    archiveStatus: IArchivingStatus;
    newArchiveStatus: IArchivingStatus;
    expected: boolean;
  }[] = [
    {
      desc: "2nd check, same archive status",
      archiveStatus: {lastFinalizedSlot: 32, finalizingSlot: null},
      newArchiveStatus: {lastFinalizedSlot: 32, finalizingSlot: null},
      expected: false,
    },
    {
      desc: "2nd check, different archive status - Block Archiver is running at different range",
      archiveStatus: {lastFinalizedSlot: 32, finalizingSlot: null},
      newArchiveStatus: {lastFinalizedSlot: 1000, finalizingSlot: 1032},
      expected: false,
    },
    {
      desc: "2nd check, different archive status - Block Archiver is running at overlappsed range",
      archiveStatus: {lastFinalizedSlot: 32, finalizingSlot: null},
      newArchiveStatus: {lastFinalizedSlot: 32, finalizingSlot: 64},
      expected: true,
    },
  ];
  for (const tc of testCases2) {
    it(tc.desc, function () {
      expect(shouldWaitForBlockArchiver(requestBody, tc.archiveStatus, tc.newArchiveStatus)).to.be.equal(tc.expected);
    });
  }
});

describe("shouldRetry", function () {
  const requestBody = {
    startSlot: 40,
    count: 30,
    step: 1,
  };
  const testCases: {
    desc: string;
    archiveStatus: IArchivingStatus;
    newArchiveStatus: IArchivingStatus;
    expected: boolean;
  }[] = [
    {
      desc: "2nd check, same archive status",
      archiveStatus: {lastFinalizedSlot: 32, finalizingSlot: null},
      newArchiveStatus: {lastFinalizedSlot: 32, finalizingSlot: null},
      expected: false,
    },
    {
      desc: "2nd check, different archive status - Block Archiver is running at different range",
      archiveStatus: {lastFinalizedSlot: 32, finalizingSlot: null},
      newArchiveStatus: {lastFinalizedSlot: 1000, finalizingSlot: 1032},
      expected: false,
    },
    {
      desc: "2nd check, different archive status - Block Archiver is completed at different range",
      archiveStatus: {lastFinalizedSlot: 32, finalizingSlot: null},
      newArchiveStatus: {lastFinalizedSlot: 1032, finalizingSlot: null},
      expected: false,
    },
    {
      desc: "2nd check, different archive status - Block Archiver is completed at overlappsed range",
      archiveStatus: {lastFinalizedSlot: 32, finalizingSlot: null},
      newArchiveStatus: {lastFinalizedSlot: 64, finalizingSlot: null},
      expected: true,
    },
  ];

  for (const tc of testCases) {
    it(tc.desc, function () {
      expect(shouldRetry(requestBody, tc.archiveStatus, tc.newArchiveStatus)).to.be.equal(tc.expected);
    });
  }
});

describe("isOverlappedRange", function () {
  const requestBody = {
    startSlot: 40,
    count: 30,
    step: 1,
  };
  it("should be overlappsed", function () {
    expect(isOverlappedRange(requestBody, 62, 96)).to.be.true;
    expect(isOverlappedRange(requestBody, 32, 64)).to.be.true;
  });
  it("should not be overlappsed", function () {
    expect(isOverlappedRange(requestBody, 0, 32)).to.be.false;
    expect(isOverlappedRange(requestBody, 96, 128)).to.be.false;
  });
});

describe("handleBeaconBlocksByRange", function () {
  const requestBody = {
    startSlot: 2021,
    count: 30,
    step: 4,
  };
  const sandbox = sinon.createSandbox();
  let dbStub: StubbedBeaconDb;
  let chainStub: StubbedBeaconChain;
  before(async () => {
    await initBLS();
  });
  beforeEach(function () {
    dbStub = new StubbedBeaconDb(sandbox);
    chainStub = new StubbedBeaconChain(sandbox, config);
  });

  it("should resolve unfinalized blocks only", async function () {
    dbStub.blockArchive.values.resolves(undefined);
    const blocks = [generateEmptySignedBlock()];
    blocks[0].message.slot = 2021;
    chainStub.getUnfinalizedBlocksAtSlots = sandbox.stub().resolves(blocks);
    const result = await handleBeaconBlocksByRange(requestBody, chainStub, dbStub);
    expect(result).to.be.deep.equal(blocks);
  });

  it("should resolve finalized blocks only", async function () {
    const blocks = [generateEmptySignedBlock()];
    blocks[0].message.slot = 2021;
    dbStub.blockArchive.values.resolves(blocks);
    chainStub.getUnfinalizedBlocksAtSlots = sandbox.stub().resolves([]);
    const result = await handleBeaconBlocksByRange(requestBody, chainStub, dbStub);
    expect(result).to.be.deep.equal(blocks);
  });

  it("should resolve both finalized blocks and unfinalized blocks", async function () {
    const finalizedBlocks = [generateEmptySignedBlock()];
    finalizedBlocks[0].message.slot = 2021;
    dbStub.blockArchive.values.resolves(finalizedBlocks);
    const unfinalizedBlocks = [generateEmptySignedBlock()];
    unfinalizedBlocks[0].message.slot = 2025;
    chainStub.getUnfinalizedBlocksAtSlots = sandbox.stub().resolves(unfinalizedBlocks);
    const result = await handleBeaconBlocksByRange(requestBody, chainStub, dbStub);
    expect(result).to.be.deep.equal([...finalizedBlocks, ...unfinalizedBlocks]);
  });
});

describe("onBeaconBlocksByRange", function () {
  const requestBody = {
    startSlot: 2021,
    count: 30,
    step: 1,
  };
  const block1 = generateEmptySignedBlock();
  block1.message.slot = requestBody.startSlot;
  const block2 = generateEmptySignedBlock();
  block2.message.slot = requestBody.startSlot + requestBody.step;
  block2.message.parentRoot = config.types.phase0.BeaconBlock.hashTreeRoot(block1.message);
  const sandbox = sinon.createSandbox();
  let dbStub: StubbedBeaconDb;
  let chainStub: StubbedBeaconChain;
  let choresStub: SinonStubbedInstance<ITaskService>;
  before(async () => {
    await initBLS();
  });
  beforeEach(function () {
    dbStub = new StubbedBeaconDb(sandbox);
    chainStub = new StubbedBeaconChain(sandbox, config);
    choresStub = sandbox.createStubInstance(TasksService);
    dbStub.blockArchive.values.resolves([block1, block2]);
    chainStub.getUnfinalizedBlocksAtSlots = sandbox.stub().resolves([]);
  });

  it("should throw error if not linear chain segment", async function () {
    choresStub.getBlockArchivingStatus.returns({lastFinalizedSlot: 3000, finalizingSlot: null});
    // the returned 2 blocks do not have parent-child relationship
    dbStub.blockArchive.values.resolves([generateEmptySignedBlock(), generateEmptySignedBlock()]);
    try {
      await onBeaconBlocksByRange(config, requestBody, chainStub, dbStub, choresStub);
      expect.fail("Expect error to be thrown due to non linear chain segment");
    } catch (e) {
      expect((e as ResponseError).status).to.be.equal(RpcResponseStatus.SERVER_ERROR);
    }
  });

  it("should return linear chain segment without waiting for BlockArchiver", async function () {
    choresStub.getBlockArchivingStatus.returns({lastFinalizedSlot: 3000, finalizingSlot: null});
    const blocks = await onBeaconBlocksByRange(config, requestBody, chainStub, dbStub, choresStub);
    expect(blocks).to.be.deep.equal([block1, block2]);
    expect(choresStub.waitForBlockArchiver.called).to.be.false;
  });

  it("should wait for BlockArchiver after 1st check", async function () {
    choresStub.getBlockArchivingStatus.returns({lastFinalizedSlot: 2021, finalizingSlot: 2053});
    choresStub.waitForBlockArchiver.resolves();
    const blocks = await onBeaconBlocksByRange(config, requestBody, chainStub, dbStub, choresStub);
    expect(blocks).to.be.deep.equal([block1, block2]);
    expect(choresStub.waitForBlockArchiver.calledOnce).to.be.true;
    expect(choresStub.getBlockArchivingStatus.calledOnce).to.be.true;
  });

  it("should wait for BlockArchiver after 2nd check", async function () {
    // 1st check is fine
    choresStub.getBlockArchivingStatus.onFirstCall().returns({lastFinalizedSlot: 2021, finalizingSlot: null});
    choresStub.getBlockArchivingStatus.onSecondCall().returns({lastFinalizedSlot: 2021, finalizingSlot: 2053});
    choresStub.waitForBlockArchiver.resolves();
    const blocks = await onBeaconBlocksByRange(config, requestBody, chainStub, dbStub, choresStub);
    expect(blocks).to.be.deep.equal([block1, block2]);
    expect(choresStub.waitForBlockArchiver.calledOnce).to.be.true;
    expect(choresStub.getBlockArchivingStatus.calledTwice).to.be.true;
    // handleBeaconBlocksByRange is called twice
    expect(dbStub.blockArchive.values.calledTwice).to.be.true;
  });
});
