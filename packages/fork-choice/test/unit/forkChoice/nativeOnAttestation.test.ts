import {describe, expect, it} from "vitest";
import {fromHexString} from "@chainsafe/ssz";
import {MAX_PENDING_DEPOSITS_PER_EPOCH, SLOTS_PER_EPOCH} from "@lodestar/params";
import {DataAvailabilityStatus, IBeaconStateView} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {ExecutionStatus, IForkChoiceStore, NativeForkChoice, PayloadStatus} from "../../../src/index.js";
import {getBlockRoot} from "../../utils/index.js";
import {VALIDATOR_COUNT, genesisSlot, gloasConfig, makeStore, toProtoBlock} from "./proposerHeadTestUtils.js";

describe("NativeForkChoice validator index bound", () => {
  const genesisRoot = fromHexString(getBlockRoot(genesisSlot));
  const genesisCheckpoint = {epoch: 0, root: genesisRoot};
  const anchorPayload = new Uint8Array(32).fill(0x22);
  const anchorParentPayload = new Uint8Array(32).fill(0x33);

  function createForkChoice(store: IForkChoiceStore): NativeForkChoice {
    return new NativeForkChoice(
      gloasConfig,
      store,
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
  }

  function state(validatorCount: number): IBeaconStateView {
    return {
      currentJustifiedCheckpoint: genesisCheckpoint,
      finalizedCheckpoint: genesisCheckpoint,
      getBlockRootAtSlot: () => genesisRoot,
      validatorCount,
    } as unknown as IBeaconStateView;
  }

  it("allows one epoch of deposits past the largest registry it has seen", () => {
    const forkChoice = createForkChoice(makeStore());
    const block = ssz.gloas.BeaconBlock.defaultValue();
    block.slot = genesisSlot + 1;
    block.parentRoot = genesisRoot;
    block.body.signedExecutionPayloadBid.message.parentBlockHash = anchorParentPayload;
    block.body.signedExecutionPayloadBid.message.blockHash = new Uint8Array(32).fill(block.slot);
    const blockRoot = ssz.gloas.BeaconBlock.hashTreeRoot(block);
    const attestation = (validatorIndex: number) => ({
      attestingIndices: [validatorIndex],
      data: {
        slot: block.slot,
        index: 0,
        beaconBlockRoot: blockRoot,
        source: genesisCheckpoint,
        target: genesisCheckpoint,
      },
      signature: new Uint8Array(96),
    });
    const limit = VALIDATOR_COUNT + MAX_PENDING_DEPOSITS_PER_EPOCH;

    forkChoice.onBlock(
      block,
      state(VALIDATOR_COUNT),
      0,
      0,
      block.slot,
      ExecutionStatus.Syncing,
      DataAvailabilityStatus.Available
    );
    forkChoice.onAttestation(attestation(limit - 1), "", true);
    expect(() => forkChoice.onAttestation(attestation(limit), "", true)).toThrow("ValidatorIndexOutOfRange");

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
    forkChoice.onAttestation(attestation(limit), "", true);
  });

  it("allows one epoch of deposits per epoch transition since finality", () => {
    const store = makeStore();
    const forkChoice = createForkChoice(store);
    forkChoice.updateTime(2 * SLOTS_PER_EPOCH);
    const limit = VALIDATOR_COUNT + 3 * MAX_PENDING_DEPOSITS_PER_EPOCH;
    const slashing = (validatorIndex: number) => {
      const value = ssz.electra.AttesterSlashing.defaultValue();
      for (const [i, attestation] of [value.attestation1, value.attestation2].entries()) {
        attestation.attestingIndices = [validatorIndex];
        attestation.data.slot = 1n;
        attestation.data.beaconBlockRoot = new Uint8Array(32).fill(i + 1);
      }
      return value;
    };

    forkChoice.onAttesterSlashing(slashing(limit - 1));
    expect(store.equivocatingIndices.has(limit - 1)).toBe(true);
    expect(() => forkChoice.onAttesterSlashing(slashing(limit))).toThrow("ValidatorIndexOutOfRange");
  });
});
