import {describe, expect, it, vi} from "vitest";
import {createChainForkConfig} from "@lodestar/config";
import {config as configDef} from "@lodestar/config/default";
import {ExecutionStatus, ProtoBlock} from "@lodestar/fork-choice";
import {ForkName} from "@lodestar/params";
import {DataAvailabilityStatus, IBeaconStateView} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {BlockInputNoData} from "../../../../src/chain/blocks/blockInput/blockInput.js";
import {BlockInputSource} from "../../../../src/chain/blocks/blockInput/types.js";
import {importBlock} from "../../../../src/chain/blocks/importBlock.js";
import {FullyVerifiedBlock} from "../../../../src/chain/blocks/types.js";
import type {BeaconChain} from "../../../../src/chain/chain.js";
import {getMockedLogger} from "../../../mocks/loggerMock.js";

describe("chain / blocks / importBlock", () => {
  const config = createChainForkConfig({...configDef, FULU_FORK_EPOCH: 0, GLOAS_FORK_EPOCH: 0});
  const parentRoot = Buffer.alloc(32, 1);
  const parentBlockHash = Buffer.alloc(32, 2);
  const stopAfterOnBlock = new Error("stop after onBlock");

  function importGloasBlock(parentVariant: ProtoBlock | null) {
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
      // The parent's default (PENDING) variant is VALID, only the payload variant may differ
      getBlockHexDefaultStatus: vi.fn().mockReturnValue({executionStatus: ExecutionStatus.Valid} as ProtoBlock),
      getBlockHexAndBlockHash: vi.fn().mockReturnValue(parentVariant),
      onBlock: vi.fn().mockImplementation(() => {
        throw stopAfterOnBlock;
      }),
    };
    const chain = {
      config,
      forkChoice,
      logger: getMockedLogger(),
      clock: {secFromSlot: vi.fn().mockReturnValue(0)},
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

    return {forkChoice, result: importBlock.call(chain, fullyVerifiedBlock, {})};
  }

  it.each([ExecutionStatus.Syncing, ExecutionStatus.Valid])(
    "gloas block inherits %s from the parent variant its bid builds on",
    async (parentStatus) => {
      const {forkChoice, result} = importGloasBlock({executionStatus: parentStatus} as ProtoBlock);

      await expect(result).rejects.toThrow(stopAfterOnBlock);
      expect(forkChoice.getBlockHexAndBlockHash).toHaveBeenCalledWith(
        toRootHex(parentRoot),
        toRootHex(parentBlockHash)
      );
      expect(forkChoice.onBlock.mock.calls[0][5]).toBe(parentStatus);
    }
  );

  it("rejects a gloas block building on an invalid parent payload", async () => {
    const {forkChoice, result} = importGloasBlock({executionStatus: ExecutionStatus.Invalid} as ProtoBlock);

    await expect(result).rejects.toThrow("Parent block has invalid execution status");
    expect(forkChoice.onBlock).not.toHaveBeenCalled();
  });

  it("rejects a gloas block whose parent variant is unknown", async () => {
    const {forkChoice, result} = importGloasBlock(null);

    await expect(result).rejects.toThrow("Parent block not found in forkChoice");
    expect(forkChoice.onBlock).not.toHaveBeenCalled();
  });
});

import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {BeaconStateView, computeEpochAtSlot} from "@lodestar/state-transition";
import {SeenAggregatedAttestations} from "../../../../src/chain/seenCache/seenAggregateAndProof.js";
import {SeenBlockAttesters} from "../../../../src/chain/seenCache/seenBlockAttesters.js";
import {ZERO_HASH_HEX} from "../../../../src/constants/index.js";
import {MockedBeaconChain, getMockedBeaconChain} from "../../../mocks/mockedBeaconChain.js";
import {MockBlockInput} from "../../../utils/blockInput.js";
import {generateCachedState} from "../../../utils/state.js";
import {generateProtoBlock} from "../../../utils/typeGenerator.js";

describe("chain / blocks / importBlock attester liveness", () => {
  it("registers block attesters under the attestation epoch, not the block epoch", async () => {
    const config = createChainForkConfig({
      ...configDef,
      ALTAIR_FORK_EPOCH: 0,
      BELLATRIX_FORK_EPOCH: 0,
      CAPELLA_FORK_EPOCH: 0,
      DENEB_FORK_EPOCH: 0,
    });
    const chain: MockedBeaconChain = getMockedBeaconChain({config});

    // First block of epoch 1 carrying an attestation for the last slot of epoch 0,
    // the normal inclusion pattern at an epoch boundary
    const blockSlot = SLOTS_PER_EPOCH;
    const attSlot = blockSlot - 1;
    const blockEpoch = computeEpochAtSlot(blockSlot);
    const attEpoch = computeEpochAtSlot(attSlot);
    // Test setup must straddle an epoch boundary
    expect(blockEpoch).toBe(attEpoch + 1);
    const attesterIndex = 103;

    const attestation = ssz.phase0.Attestation.defaultValue();
    attestation.data.slot = attSlot;
    attestation.data.target.epoch = attEpoch;

    const indexedAttestation = ssz.phase0.IndexedAttestation.defaultValue();
    indexedAttestation.data = attestation.data;
    indexedAttestation.attestingIndices = [attesterIndex];

    const block = ssz.deneb.SignedBeaconBlock.defaultValue();
    block.message.slot = blockSlot;
    block.message.body.attestations = [attestation];
    const blockRootHex = toRootHex(ssz.deneb.BeaconBlock.hashTreeRoot(block.message));

    const blockInput = new MockBlockInput({forkName: ForkName.deneb, slot: blockSlot, blockRootHex});
    blockInput.block = block;

    const seenBlockAttesters = new SeenBlockAttesters();
    Object.defineProperty(chain, "seenBlockAttesters", {value: seenBlockAttesters});
    Object.defineProperty(chain, "seenAggregatedAttestations", {value: new SeenAggregatedAttestations(null)});
    Object.defineProperty(chain, "reprocessController", {value: {onBlockImported: vi.fn()}});
    Object.defineProperty(chain, "clock", {
      value: {...chain.clock, slotWithFutureTolerance: vi.fn().mockReturnValue(blockSlot)},
    });
    Object.defineProperty(chain, "checkpointBalancesCache", {value: {processState: vi.fn()}});
    Object.defineProperty(chain, "unfinalizedBlockWrites", {
      value: {waitForSpace: vi.fn().mockResolvedValue(undefined), push: vi.fn().mockResolvedValue(undefined)},
    });

    // Head does not change, so importBlock skips the head and forkchoice update paths
    const head = generateProtoBlock({slot: blockSlot, blockRoot: blockRootHex});
    vi.mocked(chain.recomputeForkChoiceHead).mockReturnValue(head);
    vi.mocked(chain.forkChoice.getHead).mockReturnValue(head);
    vi.mocked(chain.forkChoice.getFinalizedCheckpoint).mockReturnValue({
      epoch: 0,
      root: new Uint8Array(32),
      rootHex: ZERO_HASH_HEX,
    });
    Object.defineProperty(chain.forkChoice, "getTime", {value: vi.fn().mockReturnValue(blockSlot)});
    Object.defineProperty(chain.forkChoice, "onBlock", {value: vi.fn().mockReturnValue(head)});
    Object.defineProperty(chain.forkChoice, "onAttestation", {value: vi.fn()});
    Object.defineProperty(chain.forkChoice, "updateAndGetHead", {value: vi.fn().mockReturnValue({head})});

    const fullyVerifiedBlock: FullyVerifiedBlock = {
      blockInput,
      postState: new BeaconStateView(generateCachedState()),
      parentBlockSlot: blockSlot - 1,
      proposerBalanceDelta: 0,
      dataAvailabilityStatus: DataAvailabilityStatus.Available,
      indexedAttestations: [indexedAttestation],
      seenTimestampSec: Math.floor(Date.now() / 1000),
      executionStatus: ExecutionStatus.PreMerge,
    };

    await importBlock.call(chain, fullyVerifiedBlock, {});

    // The attester must be registered under the epoch of the attestation slot,
    // not under the epoch of the block that included the attestation
    expect(seenBlockAttesters.isKnown(attEpoch, attesterIndex)).toBe(true);
    expect(seenBlockAttesters.isKnown(blockEpoch, attesterIndex)).toBe(false);
  });
});
