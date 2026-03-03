import {beforeEach, describe, expect, it} from "vitest";
import {fromHexString, toHexString} from "@chainsafe/ssz";
import {config} from "@lodestar/config/default";
import {computeEpochAtSlot, computeStartSlotAtEpoch, DataAvailabilityStatus} from "@lodestar/state-transition";
import {RootHex, Slot, ssz} from "@lodestar/types";
import {IndexedAttestation} from "@lodestar/types/phase0";
import {
  ExecutionStatus,
  ForkChoice,
  IForkChoiceStore,
  PayloadStatus,
  ProtoArray,
  ProtoBlock,
} from "../../../src/index.js";
import {getBlockRoot, getStateRoot} from "../../utils/index.js";

describe("ForkChoice onAttestation Gloas payload status routing", () => {
  const validatorCount = 1;
  const genesisEpoch = 0;
  const genesisRoot = getBlockRoot(0);
  const gloasForkSlot = computeStartSlotAtEpoch(5);

  let protoArray: ProtoArray;
  let forkChoice: ForkChoice;

  beforeEach(() => {
    const genesisBlock: Omit<ProtoBlock, "targetRoot"> = {
      slot: 0,
      blockRoot: genesisRoot,
      parentRoot: genesisRoot,
      stateRoot: getStateRoot(0),
      justifiedEpoch: genesisEpoch,
      justifiedRoot: genesisRoot,
      finalizedEpoch: genesisEpoch,
      finalizedRoot: genesisRoot,
      unrealizedJustifiedEpoch: genesisEpoch,
      unrealizedJustifiedRoot: genesisRoot,
      unrealizedFinalizedEpoch: genesisEpoch,
      unrealizedFinalizedRoot: genesisRoot,
      executionPayloadBlockHash: null,
      executionStatus: ExecutionStatus.PreMerge,
      dataAvailabilityStatus: DataAvailabilityStatus.PreData,
      timeliness: false,
      parentBlockHash: null,
      payloadStatus: PayloadStatus.FULL,
      builderIndex: null,
      blockHashFromBid: null,
    };

    protoArray = ProtoArray.initialize(genesisBlock, 0);

    const fcStore = createStore(gloasForkSlot + 1);
    forkChoice = new ForkChoice(config, fcStore, protoArray, validatorCount, null);

    const blockRoot = getBlockRoot(gloasForkSlot);
    const gloasBlock = createGloasBlock(blockRoot);
    protoArray.onBlock(gloasBlock, gloasForkSlot + 1, null);
  });

  it("keeps queued supporting vote as FULL if FULL variant appears before queue processing", () => {
    const blockRoot = getBlockRoot(gloasForkSlot);
    const attestation = createSupportingVoteAttestation(gloasForkSlot + 1, blockRoot);

    forkChoice.onAttestation(attestation, toHexString(ssz.phase0.AttestationData.hashTreeRoot(attestation.data)));

    const payloadHash = getBlockRoot(gloasForkSlot + 10);
    forkChoice.onExecutionPayload(blockRoot, payloadHash, gloasForkSlot, getStateRoot(gloasForkSlot + 10));
    forkChoice.updateTime(gloasForkSlot + 2);

    const fullIndex = protoArray.getNodeIndexByRootAndStatus(blockRoot, PayloadStatus.FULL);
    expect(fullIndex).toBeDefined();
    expect((forkChoice as any).voteNextIndices[0]).toBe(fullIndex);
  });

  it("falls back to EMPTY when FULL variant is still missing at queue processing time", () => {
    const blockRoot = getBlockRoot(gloasForkSlot);
    const attestation = createSupportingVoteAttestation(gloasForkSlot + 1, blockRoot);

    forkChoice.onAttestation(attestation, toHexString(ssz.phase0.AttestationData.hashTreeRoot(attestation.data)));
    forkChoice.updateTime(gloasForkSlot + 2);

    const emptyIndex = protoArray.getNodeIndexByRootAndStatus(blockRoot, PayloadStatus.EMPTY);
    expect(emptyIndex).toBeDefined();
    expect((forkChoice as any).voteNextIndices[0]).toBe(emptyIndex);
  });

  function createStore(currentSlot: Slot): IForkChoiceStore {
    const balances = new Uint16Array([32]);

    return {
      currentSlot,
      justified: {
        checkpoint: {
          epoch: genesisEpoch,
          root: fromHexString(genesisRoot),
          rootHex: genesisRoot,
          payloadStatus: PayloadStatus.FULL,
        },
        balances,
        totalBalance: 32,
      },
      unrealizedJustified: {
        checkpoint: {
          epoch: genesisEpoch,
          root: fromHexString(genesisRoot),
          rootHex: genesisRoot,
          payloadStatus: PayloadStatus.FULL,
        },
        balances,
      },
      finalizedCheckpoint: {
        epoch: genesisEpoch,
        root: fromHexString(genesisRoot),
        rootHex: genesisRoot,
        payloadStatus: PayloadStatus.FULL,
      },
      unrealizedFinalizedCheckpoint: {
        epoch: genesisEpoch,
        root: fromHexString(genesisRoot),
        rootHex: genesisRoot,
        payloadStatus: PayloadStatus.FULL,
      },
      justifiedBalancesGetter: () => balances,
      equivocatingIndices: new Set(),
    };
  }

  function createGloasBlock(blockRoot: RootHex): ProtoBlock {
    return {
      slot: gloasForkSlot,
      blockRoot,
      parentRoot: genesisRoot,
      stateRoot: getStateRoot(gloasForkSlot),
      targetRoot: genesisRoot,
      justifiedEpoch: genesisEpoch,
      justifiedRoot: genesisRoot,
      finalizedEpoch: genesisEpoch,
      finalizedRoot: genesisRoot,
      unrealizedJustifiedEpoch: genesisEpoch,
      unrealizedJustifiedRoot: genesisRoot,
      unrealizedFinalizedEpoch: genesisEpoch,
      unrealizedFinalizedRoot: genesisRoot,
      executionPayloadBlockHash: blockRoot,
      executionPayloadNumber: gloasForkSlot,
      executionStatus: ExecutionStatus.PayloadSeparated,
      dataAvailabilityStatus: DataAvailabilityStatus.Available,
      timeliness: false,
      parentBlockHash: genesisRoot,
      payloadStatus: PayloadStatus.FULL,
      builderIndex: 1,
      blockHashFromBid: getBlockRoot(gloasForkSlot + 5),
    };
  }

  function createSupportingVoteAttestation(slot: Slot, beaconBlockRoot: RootHex): IndexedAttestation {
    return {
      attestingIndices: [0],
      data: {
        slot,
        index: 1,
        beaconBlockRoot: fromHexString(beaconBlockRoot),
        source: {
          epoch: genesisEpoch,
          root: fromHexString(genesisRoot),
        },
        target: {
          epoch: computeEpochAtSlot(slot),
          root: fromHexString(genesisRoot),
        },
      },
      signature: Buffer.alloc(96),
    };
  }
});
