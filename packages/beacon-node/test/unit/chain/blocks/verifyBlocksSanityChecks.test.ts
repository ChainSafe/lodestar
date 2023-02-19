import sinon, {SinonStubbedInstance} from "sinon";
import {expect} from "chai";

import {config} from "@lodestar/config/default";
import {ForkChoice, IForkChoice, ProtoBlock} from "@lodestar/fork-choice";
import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {toHex} from "@lodestar/utils";
import {ChainForkConfig} from "@lodestar/config";
import {allForks, Slot, ssz} from "@lodestar/types";
import {verifyBlocksSanityChecks as verifyBlocksImportSanityChecks} from "../../../../src/chain/blocks/verifyBlocksSanityChecks.js";
import {BlockErrorCode} from "../../../../src/chain/errors/index.js";
import {expectThrowsLodestarError} from "../../../utils/errors.js";
import {BeaconClock} from "../../../../src/chain/index.js";
import {ClockStopped} from "../../../utils/mocks/clock.js";
import {getBlockInput} from "../../../../src/chain/blocks/types.js";

describe("chain / blocks / verifyBlocksSanityChecks", function () {
  let forkChoice: SinonStubbedInstance<ForkChoice>;
  let clock: ClockStopped;
  let modules: {forkChoice: IForkChoice; clock: BeaconClock; config: ChainForkConfig};
  let block: allForks.SignedBeaconBlock;
  const currentSlot = 1;

  beforeEach(() => {
    block = ssz.phase0.SignedBeaconBlock.defaultValue();
    block.message.slot = currentSlot;

    forkChoice = sinon.createStubInstance(ForkChoice);
    forkChoice.getFinalizedCheckpoint.returns({epoch: 0, root: Buffer.alloc(32), rootHex: ""});
    clock = new ClockStopped(currentSlot);
    modules = {config, forkChoice, clock} as {forkChoice: IForkChoice; clock: BeaconClock; config: ChainForkConfig};
    // On first call, parentRoot is known
    forkChoice.getBlockHex.returns({} as ProtoBlock);
  });

  it("PARENT_UNKNOWN", () => {
    forkChoice.getBlockHex.returns(null);
    expectThrowsLodestarError(() => verifyBlocksSanityChecks(modules, [block], {}), BlockErrorCode.PARENT_UNKNOWN);
  });

  it("GENESIS_BLOCK", () => {
    block.message.slot = 0;
    expectThrowsLodestarError(() => verifyBlocksSanityChecks(modules, [block], {}), BlockErrorCode.GENESIS_BLOCK);
  });

  it("ALREADY_KNOWN", () => {
    forkChoice.hasBlockHex.returns(true);
    expectThrowsLodestarError(() => verifyBlocksSanityChecks(modules, [block], {}), BlockErrorCode.ALREADY_KNOWN);
  });

  it("WOULD_REVERT_FINALIZED_SLOT", () => {
    forkChoice.getFinalizedCheckpoint.returns({epoch: 5, root: Buffer.alloc(32), rootHex: ""});
    expectThrowsLodestarError(
      () => verifyBlocksSanityChecks(modules, [block], {}),
      BlockErrorCode.WOULD_REVERT_FINALIZED_SLOT
    );
  });

  it("FUTURE_SLOT", () => {
    block.message.slot = currentSlot + 1;
    expectThrowsLodestarError(() => verifyBlocksSanityChecks(modules, [block], {}), BlockErrorCode.FUTURE_SLOT);
  });

  it("[OK, OK]", () => {
    const blocks = getValidChain(3);
    const blocksToProcess = [blocks[1], blocks[2]];

    // allBlocks[0] = Genesis, not submitted
    // allBlocks[1] = OK
    // allBlocks[2] = OK
    modules.forkChoice = getForkChoice([blocks[0]]);
    clock.setSlot(3);

    const {relevantBlocks, parentSlots} = verifyBlocksSanityChecks(modules, blocksToProcess, {ignoreIfKnown: true});

    expect(relevantBlocks).to.deep.equal([blocks[1], blocks[2]], "Wrong relevantBlocks");
    // Also check parentSlots
    expect(parentSlots).to.deep.equal(slots([blocks[0], blocks[1]]), "Wrong parentSlots");
  });

  it("[ALREADY_KNOWN, OK, OK]", () => {
    const blocks = getValidChain(4);
    const blocksToProcess = [blocks[1], blocks[2], blocks[3]];

    // allBlocks[0] = Genesis, not submitted
    // allBlocks[1] = ALREADY_KNOWN
    // allBlocks[2] = OK
    // allBlocks[3] = OK
    modules.forkChoice = getForkChoice([blocks[0], blocks[1]]);
    clock.setSlot(4);

    const {relevantBlocks} = verifyBlocksSanityChecks(modules, blocksToProcess, {
      ignoreIfKnown: true,
    });

    expectBlocks(relevantBlocks, [blocks[2], blocks[3]], blocks, "Wrong relevantBlocks");
  });

  it("[WOULD_REVERT_FINALIZED_SLOT, OK, OK]", () => {
    const finalizedEpoch = 5;
    const finalizedSlot = computeStartSlotAtEpoch(finalizedEpoch);
    const blocks = getValidChain(4, finalizedSlot - 1);
    const blocksToProcess = [blocks[1], blocks[2], blocks[3]];

    // allBlocks[0] = Genesis, not submitted
    // allBlocks[1] = WOULD_REVERT_FINALIZED_SLOT + ALREADY_KNOWN
    // allBlocks[2] = OK
    // allBlocks[3] = OK
    modules.forkChoice = getForkChoice([blocks[0], blocks[1]], finalizedEpoch);
    clock.setSlot(finalizedSlot + 4);

    const {relevantBlocks} = verifyBlocksSanityChecks(modules, blocksToProcess, {
      ignoreIfFinalized: true,
    });

    expectBlocks(relevantBlocks, [blocks[2], blocks[3]], blocks, "Wrong relevantBlocks");
  });
});

/**
 * Wrap verifyBlocksSanityChecks to deal with SignedBeaconBlock instead of BlockImport
 */
function verifyBlocksSanityChecks(
  modules: Parameters<typeof verifyBlocksImportSanityChecks>[0],
  blocks: allForks.SignedBeaconBlock[],
  opts: Parameters<typeof verifyBlocksImportSanityChecks>[2]
): {relevantBlocks: allForks.SignedBeaconBlock[]; parentSlots: Slot[]; parentBlock: ProtoBlock | null} {
  const {relevantBlocks, parentSlots, parentBlock} = verifyBlocksImportSanityChecks(
    modules,
    blocks.map((block) => getBlockInput.preDeneb(config, block)),
    opts
  );
  return {
    relevantBlocks: relevantBlocks.map(({block}) => block),
    parentSlots,
    parentBlock,
  };
}

function getValidChain(count: number, initialSlot = 0): allForks.SignedBeaconBlock[] {
  const blocks: allForks.SignedBeaconBlock[] = [];

  for (let i = 0; i < count; i++) {
    const block = ssz.phase0.SignedBeaconBlock.defaultValue();
    if (i === 0) {
      block.message.slot = initialSlot;
      block.message.parentRoot = ssz.Root.defaultValue();
    } else {
      block.message.slot = blocks[i - 1].message.slot + 1;
      block.message.parentRoot = ssz.phase0.BeaconBlock.hashTreeRoot(blocks[i - 1].message);
    }
    blocks.push(block);
  }

  return blocks;
}

function getForkChoice(knownBlocks: allForks.SignedBeaconBlock[], finalizedEpoch = 0): IForkChoice {
  const blocks = new Map<string, ProtoBlock>();
  for (const block of knownBlocks) {
    const protoBlock = toProtoBlock(block);
    blocks.set(protoBlock.blockRoot, protoBlock);
  }

  return ({
    getBlockHex(blockRoot) {
      return blocks.get(blockRoot) ?? null;
    },
    hasBlockHex(blockRoot) {
      return blocks.has(blockRoot);
    },
    getFinalizedCheckpoint() {
      return {epoch: finalizedEpoch, root: Buffer.alloc(32), rootHex: ""};
    },
  } as Partial<IForkChoice>) as IForkChoice;
}

function toProtoBlock(block: allForks.SignedBeaconBlock): ProtoBlock {
  return ({
    slot: block.message.slot,
    blockRoot: toHex(ssz.phase0.BeaconBlock.hashTreeRoot((block as allForks.SignedBeaconBlock).message)),
    parentRoot: toHex(block.message.parentRoot),
    stateRoot: toHex(block.message.stateRoot),
  } as Partial<ProtoBlock>) as ProtoBlock;
}

function slots(blocks: allForks.SignedBeaconBlock[]): Slot[] {
  return blocks.map((block) => block.message.slot);
}

/** Since blocks have no meaning compare the indexes against `allBlocks` */
function expectBlocks(
  expectedBlocks: allForks.SignedBeaconBlock[],
  actualBlocks: allForks.SignedBeaconBlock[],
  allBlocks: allForks.SignedBeaconBlock[],
  message: string
): void {
  function indexOfBlocks(blocks: allForks.SignedBeaconBlock[]): number[] {
    return blocks.map((block) => allBlocks.indexOf(block));
  }

  expect(indexOfBlocks(actualBlocks)).to.deep.equal(indexOfBlocks(expectedBlocks), `${message} - of block indexes`);
}
