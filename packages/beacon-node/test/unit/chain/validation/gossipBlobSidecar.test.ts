import {beforeEach, describe, expect, it, vi} from "vitest";
import {createChainForkConfig} from "@lodestar/config";
import {config as defaultConfig} from "@lodestar/config/default";
import {ExecutionStatus, ProtoBlock, ProtoNode} from "@lodestar/fork-choice";
import {ForkName, ZERO_HASH, ZERO_HASH_HEX} from "@lodestar/params";
import {BeaconStateView} from "@lodestar/state-transition";
import {deneb, ssz} from "@lodestar/types";
import {BlobSidecarErrorCode, GossipAction} from "../../../../src/chain/errors/index.js";
import {validateGossipBlobSidecar} from "../../../../src/chain/validation/blobSidecar.js";
import {getBlobSidecars} from "../../../../src/util/blobs.js";
import {kzg} from "../../../../src/util/kzg.js";
import {MockedBeaconChain, getMockedBeaconChain} from "../../../mocks/mockedBeaconChain.js";
import {generateCachedState} from "../../../utils/state.js";

describe("gossip blob sidecar validation", () => {
  const config = createChainForkConfig({
    ...defaultConfig,
    ALTAIR_FORK_EPOCH: 0,
    BELLATRIX_FORK_EPOCH: 0,
    CAPELLA_FORK_EPOCH: 0,
    DENEB_FORK_EPOCH: 0,
  });
  const blob = ssz.deneb.Blob.defaultValue();
  const commitment = kzg.blobToKzgCommitment(blob);
  const proof = kzg.computeBlobKzgProof(blob, commitment);
  const block = ssz.deneb.SignedBeaconBlock.defaultValue();
  block.message.slot = 1;
  block.message.body.blobKzgCommitments = [commitment];
  const sidecar = getBlobSidecars(config, block, [blob], [proof])[0];
  let chain: MockedBeaconChain;
  let message: deneb.BlobSidecar;
  let state: BeaconStateView;

  beforeEach(() => {
    chain = getMockedBeaconChain({config});
    state = new BeaconStateView(generateCachedState());
    vi.spyOn(state, "getBeaconProposer").mockReturnValue(0);
    message = ssz.deneb.BlobSidecar.clone(sidecar);
    vi.spyOn(chain.clock, "currentSlotWithGossipDisparity", "get").mockReturnValue(1);
    chain.getHeadState.mockReturnValue(state);
    chain.forkChoice.getFinalizedCheckpoint.mockReturnValue({epoch: 0, root: ZERO_HASH, rootHex: ZERO_HASH_HEX});
    chain.forkChoice.getBlockHexDefaultStatus.mockImplementation((root) =>
      root === ZERO_HASH_HEX ? ({slot: 0, blockRoot: root, executionStatus: ExecutionStatus.Valid} as ProtoBlock) : null
    );
    chain.forkChoice.getAncestor.mockReturnValue({blockRoot: ZERO_HASH_HEX} as ProtoNode);
    chain.regen.getBlockSlotState.mockResolvedValue(state);
    chain.seenBlockInputCache.isVerifiedProposerSignature.mockReturnValue(true);
    let seen = false;
    chain.seenBlockInputCache.isSeenBlobSidecar.mockImplementation(() => seen);
    chain.seenBlockInputCache.markSeenBlobSidecar.mockImplementation(() => {
      seen = true;
    });
  });

  it("ignores a duplicate tuple before signature or KZG verification", async () => {
    chain.seenBlockInputCache.isSeenBlobSidecar.mockReturnValue(true);
    message.kzgProof = Buffer.alloc(48);
    await expect(validateGossipBlobSidecar(ForkName.deneb, chain, message, 0)).rejects.toMatchObject({
      action: GossipAction.IGNORE,
      type: {code: BlobSidecarErrorCode.ALREADY_SEEN_TUPLE},
    });
    expect(chain.bls.verifySignatureSets).not.toHaveBeenCalled();
    expect(chain.regen.getBlockSlotState).not.toHaveBeenCalled();
  });

  it("does not mark a tuple seen after invalid KZG proof", async () => {
    message.kzgProof = Buffer.alloc(48);
    await expect(validateGossipBlobSidecar(ForkName.deneb, chain, message, 0)).rejects.toMatchObject({
      action: GossipAction.REJECT,
      type: {code: BlobSidecarErrorCode.INVALID_KZG_PROOF},
    });
    expect(chain.seenBlockInputCache.markSeenBlobSidecar).not.toHaveBeenCalled();
    await expect(validateGossipBlobSidecar(ForkName.deneb, chain, sidecar, 0)).resolves.toBeUndefined();
  });

  it("checks the expected proposer before verifying KZG proofs", async () => {
    message.kzgProof = Buffer.alloc(48);
    vi.spyOn(state, "getBeaconProposer").mockReturnValue(1);
    await expect(validateGossipBlobSidecar(ForkName.deneb, chain, message, 0)).rejects.toMatchObject({
      type: {code: BlobSidecarErrorCode.INCORRECT_PROPOSER},
    });
    expect(chain.seenBlockInputCache.markSeenBlobSidecar).not.toHaveBeenCalled();
  });

  it("accepts only one of two concurrent sidecars with the same tuple", async () => {
    const results = await Promise.allSettled([
      validateGossipBlobSidecar(ForkName.deneb, chain, message, 0),
      validateGossipBlobSidecar(ForkName.deneb, chain, message, 0),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({
      reason: {action: GossipAction.IGNORE, type: {code: BlobSidecarErrorCode.ALREADY_SEEN_TUPLE}},
    });
    expect(chain.seenBlockInputCache.markSeenBlobSidecar).toHaveBeenCalledOnce();
  });

  it("does not confuse execution invalidity with a failed consensus state transition", async () => {
    chain.forkChoice.getBlockHexDefaultStatus.mockImplementation((root) =>
      root === ZERO_HASH_HEX
        ? ({slot: 0, blockRoot: root, executionStatus: ExecutionStatus.Invalid} as ProtoBlock)
        : null
    );
    await expect(validateGossipBlobSidecar(ForkName.deneb, chain, message, 0)).resolves.toBeUndefined();
  });
});
