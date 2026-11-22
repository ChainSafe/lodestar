import {describe, expect, it, vi} from "vitest";
import {BitArray} from "@chainsafe/ssz";
import {createChainForkConfig} from "@lodestar/config";
import {config as configDef} from "@lodestar/config/default";
import {ExecutionStatus, ForkChoiceError, ForkChoiceErrorCode, InvalidBlockCode} from "@lodestar/fork-choice";
import {ForkName, PTC_SIZE} from "@lodestar/params";
import {DataAvailabilityStatus, IBeaconStateView} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {BlockInputNoData} from "../../../../src/chain/blocks/blockInput/blockInput.js";
import {BlockInputSource} from "../../../../src/chain/blocks/blockInput/types.js";
import {importBlock} from "../../../../src/chain/blocks/importBlock.js";
import {AttestationImportOpt, FullyVerifiedBlock} from "../../../../src/chain/blocks/types.js";
import type {BeaconChain} from "../../../../src/chain/chain.js";
import {BlockError, BlockErrorCode} from "../../../../src/chain/errors/index.js";
import {getMockedLogger} from "../../../mocks/loggerMock.js";

describe("chain / blocks / importBlock", () => {
  const config = createChainForkConfig({...configDef, FULU_FORK_EPOCH: 0, GLOAS_FORK_EPOCH: 0});
  const parentRoot = Buffer.alloc(32, 1);
  const parentBlockHash = Buffer.alloc(32, 2);

  function importGloasBlock(onBlockError: Error) {
    const block = ssz.gloas.SignedBeaconBlock.defaultValue();
    block.message.slot = 1;
    block.message.parentRoot = parentRoot;
    block.message.body.signedExecutionPayloadBid.message.parentBlockHash = parentBlockHash;
    const blockInput = BlockInputNoData.createFromBlock({
      block,
      blockRootHex: toRootHex(ssz.gloas.BeaconBlock.hashTreeRoot(block.message)),
      forkName: ForkName.gloas,
      daOutOfRange: false,
      source: BlockInputSource.gossip,
      seenTimestampSec: 0,
    });

    const forkChoice = {
      getTime: vi.fn().mockReturnValue(1),
      getFinalizedCheckpoint: vi.fn().mockReturnValue({epoch: 0}),
      onBlock: vi.fn().mockImplementation(() => {
        throw onBlockError;
      }),
    };
    const chain = {
      config,
      forkChoice,
      logger: getMockedLogger(),
      clock: {secFromSlot: vi.fn().mockReturnValue(0), msFromSlot: vi.fn().mockReturnValue(0)},
      unfinalizedBlockWrites: {
        waitForSpace: vi.fn().mockResolvedValue(undefined),
        push: vi.fn().mockResolvedValue(undefined),
      },
      checkpointBalancesCache: {processState: vi.fn()},
    } as unknown as BeaconChain;

    const fullyVerifiedBlock: FullyVerifiedBlock = {
      blockInput,
      postState: {genesisTime: 0} as IBeaconStateView,
      parentBlockSlot: 0,
      proposerBalanceDelta: 0,
      dataAvailabilityStatus: DataAvailabilityStatus.NotRequired,
      indexedAttestations: [],
      seenTimestampSec: 0,
      executionStatus: ExecutionStatus.Valid,
    };

    return importBlock.call(chain, fullyVerifiedBlock, {});
  }

  it("reports a parent invalidated during verification as PARENT_EXECUTION_INVALID", async () => {
    const result = importGloasBlock(
      new ForkChoiceError({
        code: ForkChoiceErrorCode.INVALID_BLOCK,
        err: {
          code: InvalidBlockCode.PARENT_EXECUTION_INVALID,
          root: toRootHex(parentRoot),
          hash: toRootHex(parentBlockHash),
        },
      })
    );

    await expect(result).rejects.toBeInstanceOf(BlockError);
    await expect(result).rejects.toMatchObject({
      type: {code: BlockErrorCode.PARENT_EXECUTION_INVALID, parentRoot: toRootHex(parentRoot)},
    });
  });

  it("rethrows any other fork choice error", async () => {
    const error = new ForkChoiceError({
      code: ForkChoiceErrorCode.INVALID_BLOCK,
      err: {code: InvalidBlockCode.UNKNOWN_PARENT, root: toRootHex(parentRoot), hash: toRootHex(parentBlockHash)},
    });

    await expect(importGloasBlock(error)).rejects.toBe(error);
  });

  describe("payload attestations", () => {
    const blockSlot = 5;
    const attestedSlot = blockSlot - 1;
    const multiSeatValidator = 7;
    const multiSeatPositions = [3, 17];
    const singleSeatPosition = 9;
    const ptc = Uint32Array.from({length: PTC_SIZE}, (_, i) => 1000 + i);
    for (const position of multiSeatPositions) {
      ptc[position] = multiSeatValidator;
    }

    async function importPayloadAttestation(setBits: number[]): Promise<ReturnType<typeof vi.fn>> {
      const block = ssz.gloas.SignedBeaconBlock.defaultValue();
      block.message.slot = blockSlot;
      block.message.parentRoot = parentRoot;
      const aggregationBits = BitArray.fromBitLen(PTC_SIZE);
      for (const bit of setBits) {
        aggregationBits.set(bit, true);
      }
      block.message.body.payloadAttestations = [
        {
          aggregationBits,
          data: {beaconBlockRoot: parentRoot, slot: attestedSlot, payloadPresent: true, blobDataAvailable: true},
          signature: Buffer.alloc(96),
        },
      ];
      const blockInput = BlockInputNoData.createFromBlock({
        block,
        blockRootHex: toRootHex(ssz.gloas.BeaconBlock.hashTreeRoot(block.message)),
        forkName: ForkName.gloas,
        daOutOfRange: false,
        source: BlockInputSource.gossip,
        seenTimestampSec: 0,
      });

      // Head recompute runs right after payload attestations are imported, stop there
      const stopImport = new Error("stop import");
      const notifyPtcMessages = vi.fn();
      const forkChoice = {
        getTime: vi.fn().mockReturnValue(blockSlot),
        getFinalizedCheckpoint: vi.fn().mockReturnValue({epoch: 0}),
        onBlock: vi.fn(),
        notifyPtcMessages,
        getHead: vi.fn().mockImplementation(() => {
          throw stopImport;
        }),
      };
      const chain = {
        config,
        forkChoice,
        logger: getMockedLogger(),
        clock: {msFromSlot: vi.fn().mockReturnValue(0)},
        unfinalizedBlockWrites: {
          waitForSpace: vi.fn().mockResolvedValue(undefined),
          push: vi.fn().mockResolvedValue(undefined),
        },
        checkpointBalancesCache: {processState: vi.fn()},
        regen: {processState: vi.fn()},
        singleAttestationPool: {isEmpty: vi.fn().mockReturnValue(true)},
      } as unknown as BeaconChain;

      const postState = {
        forkName: ForkName.gloas,
        genesisTime: 0,
        getPayloadTimelinessCommittee: () => ptc,
      } as unknown as IBeaconStateView;

      const fullyVerifiedBlock: FullyVerifiedBlock = {
        blockInput,
        postState,
        parentBlockSlot: attestedSlot,
        proposerBalanceDelta: 0,
        dataAvailabilityStatus: DataAvailabilityStatus.NotRequired,
        indexedAttestations: [],
        seenTimestampSec: 0,
        executionStatus: ExecutionStatus.Valid,
      };

      await expect(
        importBlock.call(chain, fullyVerifiedBlock, {importAttestations: AttestationImportOpt.Skip})
      ).rejects.toBe(stopImport);

      return notifyPtcMessages;
    }

    it("counts the vote for every PTC position of the attester", async () => {
      const notifyPtcMessages = await importPayloadAttestation([multiSeatPositions[0]]);

      expect(notifyPtcMessages).toHaveBeenCalledOnce();
      expect(notifyPtcMessages).toHaveBeenCalledWith(
        toRootHex(parentRoot),
        attestedSlot,
        multiSeatPositions,
        true,
        true
      );
    });

    it("counts a single position for an attester holding one PTC position", async () => {
      const notifyPtcMessages = await importPayloadAttestation([singleSeatPosition]);

      expect(notifyPtcMessages).toHaveBeenCalledOnce();
      expect(notifyPtcMessages).toHaveBeenCalledWith(
        toRootHex(parentRoot),
        attestedSlot,
        [singleSeatPosition],
        true,
        true
      );
    });
  });
});
