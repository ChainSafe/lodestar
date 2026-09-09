import {beforeEach, describe, expect, it, vi} from "vitest";
import {ProtoBlock} from "@lodestar/fork-choice";
import {ForkName, NUMBER_OF_COLUMNS, SLOTS_PER_EPOCH} from "@lodestar/params";
import {IBeaconStateView} from "@lodestar/state-transition";
import {fulu, gloas, ssz} from "@lodestar/types";
import {
  DataColumnSidecarErrorCode,
  DataColumnSidecarValidationError,
} from "../../../../src/chain/errors/dataColumnSidecarError.js";
import {
  computeSubnetForDataColumnSidecar,
  validateFuluBlockDataColumnSidecars,
  validateGloasBlockDataColumnSidecars,
  validateGossipFuluDataColumnSidecar,
} from "../../../../src/chain/validation/dataColumnSidecar.js";
import {ZERO_HASH} from "../../../../src/constants/index.js";
import {MockedBeaconChain, getMockedBeaconChain} from "../../../mocks/mockedBeaconChain.js";
import {FULU_FORK_EPOCH, config, generateBlockWithColumnSidecars} from "../../../utils/blocksAndData.js";
import {expectRejectedWithLodestarError} from "../../../utils/errors.js";

describe("validateFuluBlockDataColumnSidecars", () => {
  const {block, blockRoot, columnSidecars} = generateBlockWithColumnSidecars({forkName: ForkName.fulu});

  it("should validate correct column sidecars", async () => {
    await expect(
      validateFuluBlockDataColumnSidecars(
        null,
        block.message.slot,
        blockRoot,
        block.message.body.blobKzgCommitments.length,
        columnSidecars
      )
    ).resolves.toBeUndefined();
  });

  it("should validate empty sidecars array", async () => {
    await expect(
      validateFuluBlockDataColumnSidecars(
        null,
        block.message.slot,
        blockRoot,
        block.message.body.blobKzgCommitments.length,
        []
      )
    ).resolves.toBeUndefined();
  });

  it("should error on no blobs in block", async () => {
    await expect(
      validateFuluBlockDataColumnSidecars(null, block.message.slot, blockRoot, 0, columnSidecars)
    ).rejects.toThrow(DataColumnSidecarValidationError);
  });

  it("should error if sidecar block header doesn't match block", async () => {
    const invalidSidecar = ssz.fulu.DataColumnSidecar.clone(columnSidecars[0]);
    invalidSidecar.signedBlockHeader.message.slot += 1; // invalid slot (will change the root)

    await expect(
      validateFuluBlockDataColumnSidecars(
        null,
        block.message.slot,
        blockRoot,
        block.message.body.blobKzgCommitments.length,
        [invalidSidecar]
      )
    ).rejects.toThrow(DataColumnSidecarValidationError);
  });

  it("should error on invalid column index", async () => {
    const invalidSidecar = ssz.fulu.DataColumnSidecar.clone(columnSidecars[0]);
    invalidSidecar.index = NUMBER_OF_COLUMNS; // invalid index

    await expect(
      validateFuluBlockDataColumnSidecars(
        null,
        block.message.slot,
        blockRoot,
        block.message.body.blobKzgCommitments.length,
        [invalidSidecar]
      )
    ).rejects.toThrow(DataColumnSidecarValidationError);
  });

  it("should error on invalid kzg commitments", async () => {
    const invalidSidecar = ssz.fulu.DataColumnSidecar.clone(columnSidecars[0]);
    invalidSidecar.kzgCommitments = columnSidecars[0].kzgCommitments.map((commitment) => commitment.map((b) => b ^ 1)); // invalid commitments

    await expect(
      validateFuluBlockDataColumnSidecars(
        null,
        block.message.slot,
        blockRoot,
        block.message.body.blobKzgCommitments.length,
        [invalidSidecar]
      )
    ).rejects.toThrow(DataColumnSidecarValidationError);
  });

  it("should error on invalid kzg commitments inclusion proofs", async () => {
    const invalidSidecar = ssz.fulu.DataColumnSidecar.clone(columnSidecars[0]);
    invalidSidecar.kzgCommitmentsInclusionProof[0][0] ^= 1; // invalid inclusion proof

    await expect(
      validateFuluBlockDataColumnSidecars(
        null,
        block.message.slot,
        blockRoot,
        block.message.body.blobKzgCommitments.length,
        [invalidSidecar]
      )
    ).rejects.toThrow(DataColumnSidecarValidationError);
  });

  it("should error on invalid kzg proof", async () => {
    const invalidSidecar = ssz.fulu.DataColumnSidecar.clone(columnSidecars[0]);
    invalidSidecar.kzgProofs = columnSidecars[0].kzgProofs.map((proof) => proof.map((b) => b ^ 1)); // invalid proofs

    await expect(
      validateFuluBlockDataColumnSidecars(
        null,
        block.message.slot,
        blockRoot,
        block.message.body.blobKzgCommitments.length,
        [invalidSidecar]
      )
    ).rejects.toThrow(DataColumnSidecarValidationError);
  });

  it("should error on invalid kzg proof count", async () => {
    const invalidSidecar = ssz.fulu.DataColumnSidecar.clone(columnSidecars[0]);
    invalidSidecar.kzgProofs = invalidSidecar.kzgProofs.slice(1);

    await expect(
      validateFuluBlockDataColumnSidecars(
        null,
        block.message.slot,
        blockRoot,
        block.message.body.blobKzgCommitments.length,
        [invalidSidecar]
      )
    ).rejects.toThrow(DataColumnSidecarValidationError);
  });

  it("should error on invalid cell count", async () => {
    const invalidSidecar = ssz.fulu.DataColumnSidecar.clone(columnSidecars[0]);
    invalidSidecar.column = invalidSidecar.column.slice(1);

    await expect(
      validateFuluBlockDataColumnSidecars(
        null,
        block.message.slot,
        blockRoot,
        block.message.body.blobKzgCommitments.length,
        [invalidSidecar]
      )
    ).rejects.toThrow(DataColumnSidecarValidationError);
  });
});

describe("validateGloasBlockDataColumnSidecars", () => {
  const {block, blockRoot, columnSidecars} = generateBlockWithColumnSidecars({forkName: ForkName.gloas});
  const blockKzgCommitments = block.message.body.signedExecutionPayloadBid.message.blobKzgCommitments;

  it("should validate correct column sidecars", async () => {
    await expect(
      validateGloasBlockDataColumnSidecars(
        block.message.slot,
        blockRoot,
        blockKzgCommitments,
        columnSidecars as gloas.DataColumnSidecar[]
      )
    ).resolves.toBeUndefined();
  });

  it("should validate empty sidecars array", async () => {
    await expect(
      validateGloasBlockDataColumnSidecars(block.message.slot, blockRoot, blockKzgCommitments, [])
    ).resolves.toBeUndefined();
  });

  it("should error on no blobs in block", async () => {
    await expect(
      validateGloasBlockDataColumnSidecars(
        block.message.slot,
        blockRoot,
        [],
        columnSidecars as gloas.DataColumnSidecar[]
      )
    ).rejects.toThrow(DataColumnSidecarValidationError);
  });

  it("should error if sidecar slot doesn't match block", async () => {
    const invalidSidecar = ssz.gloas.DataColumnSidecar.clone(columnSidecars[0] as gloas.DataColumnSidecar);
    invalidSidecar.slot += 1;

    await expect(
      validateGloasBlockDataColumnSidecars(block.message.slot, blockRoot, blockKzgCommitments, [invalidSidecar])
    ).rejects.toThrow(DataColumnSidecarValidationError);
  });

  it("should error if sidecar block root doesn't match block", async () => {
    const invalidSidecar = ssz.gloas.DataColumnSidecar.clone(columnSidecars[0] as gloas.DataColumnSidecar);
    invalidSidecar.beaconBlockRoot = Uint8Array.from(blockRoot);
    invalidSidecar.beaconBlockRoot[0] ^= 1;

    await expect(
      validateGloasBlockDataColumnSidecars(block.message.slot, blockRoot, blockKzgCommitments, [invalidSidecar])
    ).rejects.toThrow(DataColumnSidecarValidationError);
  });

  it("should error on invalid column index", async () => {
    const invalidSidecar = ssz.gloas.DataColumnSidecar.clone(columnSidecars[0] as gloas.DataColumnSidecar);
    invalidSidecar.index = NUMBER_OF_COLUMNS;

    await expect(
      validateGloasBlockDataColumnSidecars(block.message.slot, blockRoot, blockKzgCommitments, [invalidSidecar])
    ).rejects.toThrow(DataColumnSidecarValidationError);
  });

  it("should error on invalid kzg proof count", async () => {
    const invalidSidecar = ssz.gloas.DataColumnSidecar.clone(columnSidecars[0] as gloas.DataColumnSidecar);
    invalidSidecar.kzgProofs = invalidSidecar.kzgProofs.slice(1);

    await expect(
      validateGloasBlockDataColumnSidecars(block.message.slot, blockRoot, blockKzgCommitments, [invalidSidecar])
    ).rejects.toThrow(DataColumnSidecarValidationError);
  });

  it("should error on invalid kzg proof", async () => {
    const invalidSidecar = ssz.gloas.DataColumnSidecar.clone(columnSidecars[0] as gloas.DataColumnSidecar);
    invalidSidecar.kzgProofs = invalidSidecar.kzgProofs.map((proof) => proof.map((b) => b ^ 1));

    await expect(
      validateGloasBlockDataColumnSidecars(block.message.slot, blockRoot, blockKzgCommitments, [invalidSidecar])
    ).rejects.toThrow(DataColumnSidecarValidationError);
  });

  it("should error on invalid cell count", async () => {
    const invalidSidecar = ssz.gloas.DataColumnSidecar.clone(columnSidecars[0] as gloas.DataColumnSidecar);
    invalidSidecar.column = invalidSidecar.column.slice(1); // remove one cell

    await expect(
      validateGloasBlockDataColumnSidecars(block.message.slot, blockRoot, blockKzgCommitments, [invalidSidecar])
    ).rejects.toThrow(DataColumnSidecarValidationError);
  });
});

describe("validateGossipFuluDataColumnSidecar - proposer lookup", () => {
  // Block deep inside fulu so its recent-epoch parents are also post-fulu.
  const deepFulu = generateBlockWithColumnSidecars({
    forkName: ForkName.fulu,
    slot: (FULU_FORK_EPOCH + 2) * SLOTS_PER_EPOCH,
  }).columnSidecars[0] as fulu.DataColumnSidecar;
  // Block at the very first fulu slot, so a parent one slot back is pre-fulu (fork transition boundary).
  const fuluBoundary = generateBlockWithColumnSidecars({
    forkName: ForkName.fulu,
    slot: FULU_FORK_EPOCH * SLOTS_PER_EPOCH,
  }).columnSidecars[0] as fulu.DataColumnSidecar;

  let chain: MockedBeaconChain;

  beforeEach(() => {
    chain = getMockedBeaconChain({config});
  });

  // Wire the mocked chain to reach step 13 for `sidecar` with the parent at `parentSlot`. A wrong expected
  // proposer forces a REJECT there (before signature/inclusion/kzg), isolating the state-lookup branch.
  function setup(sidecar: fulu.DataColumnSidecar, parentSlot: number): number {
    const wrongProposer = sidecar.signedBlockHeader.message.proposerIndex + 1;
    vi.spyOn(chain.clock, "currentSlotWithGossipDisparity", "get").mockReturnValue(
      sidecar.signedBlockHeader.message.slot
    );
    chain.forkChoice.getFinalizedCheckpoint.mockReturnValue({epoch: 0, root: ZERO_HASH, rootHex: ""});
    chain.forkChoice.getBlockHexDefaultStatus.mockReturnValue({slot: parentSlot, stateRoot: "0x00"} as ProtoBlock);
    const stateStub = {getBeaconProposer: () => wrongProposer} as unknown as IBeaconStateView;
    chain.regen.getState.mockResolvedValue(stateStub);
    chain.regen.getBlockSlotState.mockResolvedValue(stateStub);
    return computeSubnetForDataColumnSidecar(chain.config, sidecar);
  }

  it("reads the proposer via getState (no dial) when a post-fulu parent is within MIN_SEED_LOOKAHEAD", async () => {
    const subnet = setup(deepFulu, deepFulu.signedBlockHeader.message.slot - 1);

    await expectRejectedWithLodestarError(
      validateGossipFuluDataColumnSidecar(chain, deepFulu, subnet, null),
      DataColumnSidecarErrorCode.INCORRECT_PROPOSER
    );

    expect(chain.regen.getState).toHaveBeenCalledOnce();
    expect(chain.regen.getBlockSlotState).not.toHaveBeenCalled();
  });

  it("dials via getBlockSlotState when the block is more than MIN_SEED_LOOKAHEAD epochs after its parent", async () => {
    const subnet = setup(deepFulu, deepFulu.signedBlockHeader.message.slot - 2 * SLOTS_PER_EPOCH);

    await expectRejectedWithLodestarError(
      validateGossipFuluDataColumnSidecar(chain, deepFulu, subnet, null),
      DataColumnSidecarErrorCode.INCORRECT_PROPOSER
    );

    expect(chain.regen.getBlockSlotState).toHaveBeenCalledOnce();
    expect(chain.regen.getState).not.toHaveBeenCalled();
  });

  it("dials via getBlockSlotState when the parent is pre-fulu (fork transition boundary)", async () => {
    const subnet = setup(fuluBoundary, fuluBoundary.signedBlockHeader.message.slot - 1);

    await expectRejectedWithLodestarError(
      validateGossipFuluDataColumnSidecar(chain, fuluBoundary, subnet, null),
      DataColumnSidecarErrorCode.INCORRECT_PROPOSER
    );

    expect(chain.regen.getBlockSlotState).toHaveBeenCalledOnce();
    expect(chain.regen.getState).not.toHaveBeenCalled();
  });
});
