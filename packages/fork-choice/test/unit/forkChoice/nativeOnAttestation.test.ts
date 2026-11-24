import {describe, expect, it} from "vitest";
import {fromHexString} from "@chainsafe/ssz";
import {DataAvailabilityStatus, IBeaconStateView} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {ExecutionStatus, NativeForkChoice, PayloadStatus} from "../../../src/index.js";
import {getBlockRoot} from "../../utils/index.js";
import {VALIDATOR_COUNT, genesisSlot, gloasConfig, makeStore, toProtoBlock} from "./proposerHeadTestUtils.js";

describe("NativeForkChoice onAttestation", () => {
  const genesisRoot = fromHexString(getBlockRoot(genesisSlot));
  const genesisCheckpoint = {epoch: 0, root: genesisRoot};
  const anchorPayload = new Uint8Array(32).fill(0x22);
  const anchorParentPayload = new Uint8Array(32).fill(0x33);

  it("bounds attesting indices by the largest registry it has seen", () => {
    const forkChoice = new NativeForkChoice(
      gloasConfig,
      makeStore(),
      {
        block: toProtoBlock(genesisSlot, toRootHex(new Uint8Array(32)), true, {
          parentBlockHash: toRootHex(anchorParentPayload),
          executionPayloadBlockHash: toRootHex(anchorParentPayload),
          executionStatus: ExecutionStatus.Syncing,
          payloadStatus: PayloadStatus.PENDING,
        }),
        stateSlot: genesisSlot,
        genesisTime: 0,
        genesisValidatorsRoot: new Uint8Array(32),
        justifiedCheckpoint: genesisCheckpoint,
        finalizedCheckpoint: genesisCheckpoint,
        payloadBlockHash: anchorPayload,
        bidParentBlockHash: anchorParentPayload,
      },
      null
    );
    const block = ssz.gloas.BeaconBlock.defaultValue();
    block.slot = genesisSlot + 1;
    block.parentRoot = genesisRoot;
    block.body.signedExecutionPayloadBid.message.parentBlockHash = anchorParentPayload;
    block.body.signedExecutionPayloadBid.message.blockHash = new Uint8Array(32).fill(block.slot);
    const blockRoot = ssz.gloas.BeaconBlock.hashTreeRoot(block);
    const attestation = {
      attestingIndices: [VALIDATOR_COUNT],
      data: {
        slot: block.slot,
        index: 0,
        beaconBlockRoot: blockRoot,
        source: genesisCheckpoint,
        target: genesisCheckpoint,
      },
      signature: new Uint8Array(96),
    };

    const state = (validatorCount: number) =>
      ({
        currentJustifiedCheckpoint: genesisCheckpoint,
        finalizedCheckpoint: genesisCheckpoint,
        getBlockRootAtSlot: () => genesisRoot,
        validatorCount,
      }) as unknown as IBeaconStateView;
    forkChoice.onBlock(
      block,
      state(VALIDATOR_COUNT),
      0,
      0,
      block.slot,
      ExecutionStatus.Syncing,
      DataAvailabilityStatus.Available
    );
    expect(() => forkChoice.onAttestation(attestation, "", true)).toThrow("ValidatorIndexOutOfRange");

    const sibling = ssz.gloas.BeaconBlock.clone(block);
    sibling.proposerIndex = 1;
    forkChoice.onBlock(
      sibling,
      state(VALIDATOR_COUNT + 1),
      0,
      0,
      block.slot,
      ExecutionStatus.Syncing,
      DataAvailabilityStatus.Available
    );
    forkChoice.onAttestation(attestation, "", true);
  });
});
