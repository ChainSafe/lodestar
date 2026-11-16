import {beforeEach, describe, expect, it, vi} from "vitest";
import {routes} from "@lodestar/api";
import {createChainForkConfig} from "@lodestar/config";
import {config as configDef} from "@lodestar/config/default";
import {PayloadStatus} from "@lodestar/fork-choice";
import {ForkName, NUMBER_OF_COLUMNS} from "@lodestar/params";
import {IBeaconStateView} from "@lodestar/state-transition";
import {gloas, ssz} from "@lodestar/types";
import {fromHex, toRootHex} from "@lodestar/utils";
import {getBeaconBlockApi} from "../../../../../../src/api/impl/beacon/blocks/index.js";
import {defaultApiOptions} from "../../../../../../src/api/options.js";
import {PayloadEnvelopeInput} from "../../../../../../src/chain/blocks/payloadEnvelopeInput/payloadEnvelopeInput.js";
import {PayloadEnvelopeInputSource} from "../../../../../../src/chain/blocks/payloadEnvelopeInput/types.js";
import {
  ExecutionPayloadEnvelopeError,
  ExecutionPayloadEnvelopeErrorCode,
  GossipAction,
} from "../../../../../../src/chain/errors/index.js";
import {SeenBlockProposers} from "../../../../../../src/chain/seenCache/seenBlockProposers.js";
import {validateApiExecutionPayloadEnvelope} from "../../../../../../src/chain/validation/executionPayloadEnvelope.js";
import {ApiTestModules, getApiTestModules} from "../../../../../utils/api.js";
import {config as forkConfig, generateBlockWithColumnSidecars} from "../../../../../utils/blocksAndData.js";
import {generateProtoBlock} from "../../../../../utils/typeGenerator.js";

vi.mock("../../../../../../src/chain/blocks/verifyExecutionPayloadEnvelope.js", () => ({
  verifyExecutionPayloadEnvelope: vi.fn(),
}));
vi.mock("../../../../../../src/chain/validation/executionPayloadEnvelope.js", () => ({
  validateApiExecutionPayloadEnvelope: vi.fn(),
}));

describe("api - beacon - publishExecutionPayloadEnvelope", () => {
  const config = createChainForkConfig({
    ...configDef,
    ALTAIR_FORK_EPOCH: 0,
    BELLATRIX_FORK_EPOCH: 0,
    CAPELLA_FORK_EPOCH: 0,
    DENEB_FORK_EPOCH: 0,
    ELECTRA_FORK_EPOCH: 0,
    FULU_FORK_EPOCH: 0,
    GLOAS_FORK_EPOCH: 0,
  });
  let modules: ApiTestModules;

  beforeEach(() => {
    modules = getApiTestModules({config});
    Object.defineProperty(modules.chain, "blockProductionCache", {value: {get: vi.fn()}});
    Object.defineProperty(modules.chain, "seenBlockProposers", {value: new SeenBlockProposers()});
    modules.network.publishExecutionPayloadEnvelope = vi.fn();
    modules.chain.processExecutionPayload = vi.fn();
  });

  describe("broadcast_validation=consensus_and_equivocation", () => {
    it("rejects an envelope for an observed proposer equivocation", async () => {
      const signedBlock = ssz.gloas.SignedBeaconBlock.defaultValue();
      const slot = signedBlock.message.slot;
      const proposerIndex = signedBlock.message.proposerIndex;
      const blockRoot = toRootHex(config.getForkTypes(slot).BeaconBlock.hashTreeRoot(signedBlock.message));
      const conflictingBlockRoot = toRootHex(Buffer.alloc(32, 1));
      const payloadInput = PayloadEnvelopeInput.createFromBlock({
        blockRootHex: blockRoot,
        block: signedBlock,
        forkName: ForkName.gloas,
        sampledColumns: [],
        custodyColumns: [],
        seenTimestampSec: 0,
        source: PayloadEnvelopeInputSource.byRange,
        daOutOfRange: false,
      });
      const envelope = ssz.gloas.ExecutionPayloadEnvelope.defaultValue();
      envelope.beaconBlockRoot = fromHex(blockRoot);
      envelope.payload.slotNumber = slot;

      modules.forkChoice.getBlockHex.mockReturnValue(generateProtoBlock({slot}));
      vi.mocked(modules.chain.seenPayloadEnvelopeInputCache.get).mockReturnValue(payloadInput);
      modules.chain.regen.getBlockSlotState.mockResolvedValue({forkName: ForkName.gloas} as IBeaconStateView);
      modules.chain.seenBlockProposers.add(slot, proposerIndex, blockRoot);
      modules.chain.seenBlockProposers.observeBlockRoot(
        slot,
        proposerIndex,
        blockRoot,
        ssz.phase0.SignedBeaconBlockHeader.defaultValue()
      );
      modules.chain.seenBlockProposers.observeBlockRoot(
        slot,
        proposerIndex,
        conflictingBlockRoot,
        ssz.phase0.SignedBeaconBlockHeader.defaultValue()
      );

      const api = getBeaconBlockApi(defaultApiOptions, modules);
      await expect(
        api.publishExecutionPayloadEnvelope({
          executionPayloadEnvelopeContents: {executionPayloadEnvelope: envelope, kzgProofs: [], blobs: []},
          broadcastValidation: routes.beacon.BroadcastValidation.consensusAndEquivocation,
        })
      ).rejects.toThrow(/proposer equivocation/);

      expect(modules.network.publishExecutionPayloadEnvelope).not.toHaveBeenCalled();
      expect(modules.chain.processExecutionPayload).not.toHaveBeenCalled();
      expect(payloadInput.hasPayloadEnvelope()).toBe(false);
    });
  });

  describe("broadcast_validation=gossip", () => {
    function setupPayloadInput(): {
      payloadInput: PayloadEnvelopeInput;
      envelope: gloas.ExecutionPayloadEnvelope;
    } {
      const signedBlock = ssz.gloas.SignedBeaconBlock.defaultValue();
      const slot = signedBlock.message.slot;
      const blockRoot = toRootHex(config.getForkTypes(slot).BeaconBlock.hashTreeRoot(signedBlock.message));
      const payloadInput = PayloadEnvelopeInput.createFromBlock({
        blockRootHex: blockRoot,
        block: signedBlock,
        forkName: ForkName.gloas,
        sampledColumns: [],
        custodyColumns: [],
        seenTimestampSec: 0,
        source: PayloadEnvelopeInputSource.byRange,
        daOutOfRange: false,
      });
      const envelope = ssz.gloas.ExecutionPayloadEnvelope.defaultValue();
      envelope.beaconBlockRoot = fromHex(blockRoot);
      envelope.payload.slotNumber = slot;

      modules.forkChoice.getBlockHex.mockReturnValue(generateProtoBlock({slot}));
      vi.mocked(modules.chain.seenPayloadEnvelopeInputCache.get).mockReturnValue(payloadInput);
      return {payloadInput, envelope};
    }

    it("skips envelope verification on import of the submitted envelope", async () => {
      const {payloadInput, envelope} = setupPayloadInput();

      const api = getBeaconBlockApi(defaultApiOptions, modules);
      await api.publishExecutionPayloadEnvelope({
        executionPayloadEnvelopeContents: {executionPayloadEnvelope: envelope, kzgProofs: [], blobs: []},
        broadcastValidation: routes.beacon.BroadcastValidation.gossip,
      });

      expect(payloadInput.getPayloadEnvelope()).toBe(envelope);
      expect(modules.chain.processExecutionPayload).toHaveBeenCalledWith(payloadInput, {validEnvelope: true});
    });

    it("verifies the envelope on import if it was added by another source", async () => {
      const {payloadInput, envelope} = setupPayloadInput();
      const cachedEnvelope = ssz.gloas.ExecutionPayloadEnvelope.clone(envelope);
      payloadInput.addPayloadEnvelope({
        envelope: cachedEnvelope,
        source: PayloadEnvelopeInputSource.byRange,
        seenTimestampSec: 0,
        peerIdStr: undefined,
      });

      const api = getBeaconBlockApi(defaultApiOptions, modules);
      await api.publishExecutionPayloadEnvelope({
        executionPayloadEnvelopeContents: {executionPayloadEnvelope: envelope, kzgProofs: [], blobs: []},
        broadcastValidation: routes.beacon.BroadcastValidation.gossip,
      });

      expect(payloadInput.getPayloadEnvelope()).toBe(cachedEnvelope);
      expect(modules.chain.processExecutionPayload).toHaveBeenCalledWith(payloadInput, {validEnvelope: false});
    });
  });

  describe("blob data", () => {
    const sampledColumns = [0, 1];
    /** Columns of the payload this node has seen before the envelope is published through the API */
    const seenColumns = 10;

    function setupBlobs(): {
      blockRoot: string;
      block: gloas.SignedBeaconBlock;
      payloadInput: PayloadEnvelopeInput;
      envelope: gloas.ExecutionPayloadEnvelope;
      blobs: Uint8Array[];
      kzgProofs: Uint8Array[];
      columnSidecars: gloas.DataColumnSidecar[];
    } {
      const generated = generateBlockWithColumnSidecars({forkName: ForkName.gloas, returnBlobs: true});
      const block = generated.block as gloas.SignedBeaconBlock;
      const blobs = generated.blobs;
      if (blobs === undefined) {
        throw Error("Missing generated blobs");
      }
      const slot = block.message.slot;
      const kzgProofs = blobs.flatMap((_, rowIndex) =>
        generated.columnSidecars.map((columnSidecar) => columnSidecar.kzgProofs[rowIndex])
      );

      const envelope = ssz.gloas.ExecutionPayloadEnvelope.defaultValue();
      envelope.payload.slotNumber = slot;
      envelope.payload.blockHash = Buffer.alloc(32, 0x22);
      envelope.parentBeaconBlockRoot = block.message.parentRoot;

      // The bid commits to the payload and the execution requests of the envelope
      const bid = block.message.body.signedExecutionPayloadBid.message;
      bid.slot = slot;
      bid.blockHash = envelope.payload.blockHash;
      bid.payloadRoot = ssz.gloas.ExecutionPayload.hashTreeRoot(envelope.payload);
      bid.executionRequestsRoot = ssz.gloas.ExecutionRequests.hashTreeRoot(envelope.executionRequests);
      const blockRoot = toRootHex(ssz.gloas.BeaconBlock.hashTreeRoot(block.message));
      envelope.beaconBlockRoot = fromHex(blockRoot);

      const columnSidecars = (generated.columnSidecars as gloas.DataColumnSidecar[]).map((columnSidecar) => ({
        ...columnSidecar,
        beaconBlockRoot: envelope.beaconBlockRoot,
      }));

      const payloadInput = PayloadEnvelopeInput.createFromBlock({
        blockRootHex: blockRoot,
        block,
        forkName: ForkName.gloas,
        sampledColumns,
        custodyColumns: sampledColumns,
        seenTimestampSec: 0,
        source: PayloadEnvelopeInputSource.gossip,
        daOutOfRange: false,
      });

      modules = getApiTestModules({config: forkConfig});
      Object.defineProperty(modules.chain, "blockProductionCache", {value: {get: vi.fn()}});
      Object.defineProperty(modules.chain, "seenBlockProposers", {value: new SeenBlockProposers()});
      modules.network.publishExecutionPayloadEnvelope = vi.fn().mockResolvedValue(1);
      modules.network.publishDataColumnSidecar = vi.fn().mockResolvedValue({sentPeers: 1, alreadyPublished: false});
      modules.chain.processExecutionPayload = vi.fn();
      // The block is imported, its payload is not
      modules.forkChoice.getBlockHex.mockImplementation((_blockRoot, payloadStatus) =>
        payloadStatus === PayloadStatus.FULL
          ? null
          : generateProtoBlock({slot, blockRoot, parentRoot: toRootHex(block.message.parentRoot)})
      );
      vi.mocked(modules.chain.seenPayloadEnvelopeInputCache.get).mockReturnValue(payloadInput);

      return {blockRoot, block, payloadInput, envelope, blobs, kzgProofs, columnSidecars};
    }

    /** The node has seen the envelope and some of its data columns on gossip */
    function setKnownEnvelope(
      payloadInput: PayloadEnvelopeInput,
      envelope: gloas.ExecutionPayloadEnvelope,
      columnSidecars: gloas.DataColumnSidecar[]
    ): gloas.ExecutionPayloadEnvelope {
      const knownEnvelope = ssz.gloas.ExecutionPayloadEnvelope.clone(envelope);
      payloadInput.addPayloadEnvelope({
        envelope: knownEnvelope,
        source: PayloadEnvelopeInputSource.gossip,
        seenTimestampSec: 0,
        peerIdStr: undefined,
      });
      for (const columnSidecar of columnSidecars.slice(0, seenColumns)) {
        payloadInput.addColumn({
          columnSidecar,
          source: PayloadEnvelopeInputSource.gossip,
          seenTimestampSec: 0,
          peerIdStr: undefined,
        });
      }
      vi.mocked(validateApiExecutionPayloadEnvelope).mockRejectedValueOnce(
        new ExecutionPayloadEnvelopeError(GossipAction.IGNORE, {
          code: ExecutionPayloadEnvelopeErrorCode.ENVELOPE_ALREADY_KNOWN,
          blockRoot: payloadInput.blockRootHex,
          slot: payloadInput.slot,
        })
      );
      return knownEnvelope;
    }

    it("publishes the envelope and the data columns of the submitted blobs", async () => {
      const {blockRoot, payloadInput, envelope, blobs, kzgProofs} = setupBlobs();
      const onGossip = vi.fn();
      modules.chain.emitter.on(routes.events.EventType.executionPayloadGossip, onGossip);

      const api = getBeaconBlockApi(defaultApiOptions, modules);
      await api.publishExecutionPayloadEnvelope({
        executionPayloadEnvelopeContents: {executionPayloadEnvelope: envelope, kzgProofs, blobs},
        broadcastValidation: routes.beacon.BroadcastValidation.gossip,
      });

      expect(modules.network.publishExecutionPayloadEnvelope).toHaveBeenCalledExactlyOnceWith(envelope);
      expect(modules.network.publishDataColumnSidecar).toHaveBeenCalledTimes(NUMBER_OF_COLUMNS);
      expect(payloadInput.getAllColumns()).toHaveLength(NUMBER_OF_COLUMNS);
      expect(onGossip).toHaveBeenCalledExactlyOnceWith({
        slot: payloadInput.slot,
        builderIndex: payloadInput.getBuilderIndex(),
        blockHash: toRootHex(envelope.payload.blockHash),
        payloadRoot: toRootHex(ssz.gloas.ExecutionPayload.hashTreeRoot(envelope.payload)),
        blockRoot,
      });
    });

    it("rejects blobs and proofs that do not match the bid commitments, and neither publishes nor stores anything", async () => {
      const {payloadInput, envelope, blobs, kzgProofs} = setupBlobs();
      const badKzgProofs = [kzgProofs[1], kzgProofs[0], ...kzgProofs.slice(2)];

      const api = getBeaconBlockApi(defaultApiOptions, modules);
      await expect(
        api.publishExecutionPayloadEnvelope({
          executionPayloadEnvelopeContents: {executionPayloadEnvelope: envelope, kzgProofs: badKzgProofs, blobs},
          broadcastValidation: routes.beacon.BroadcastValidation.gossip,
        })
      ).rejects.toMatchObject({statusCode: 400});

      expect(modules.network.publishExecutionPayloadEnvelope).not.toHaveBeenCalled();
      expect(modules.network.publishDataColumnSidecar).not.toHaveBeenCalled();
      expect(modules.chain.processExecutionPayload).not.toHaveBeenCalled();
      expect(payloadInput.hasPayloadEnvelope()).toBe(false);
      expect(payloadInput.getAllColumns()).toHaveLength(0);
    });

    it("rejects blobs other than those of the bid commitments", async () => {
      const {payloadInput, envelope, blobs, kzgProofs} = setupBlobs();
      const otherBlobs = [new Uint8Array(blobs[0].length), ...blobs.slice(1)];

      const api = getBeaconBlockApi(defaultApiOptions, modules);
      await expect(
        api.publishExecutionPayloadEnvelope({
          executionPayloadEnvelopeContents: {executionPayloadEnvelope: envelope, kzgProofs, blobs: otherBlobs},
          broadcastValidation: routes.beacon.BroadcastValidation.gossip,
        })
      ).rejects.toMatchObject({statusCode: 400});

      expect(modules.network.publishExecutionPayloadEnvelope).not.toHaveBeenCalled();
      expect(modules.network.publishDataColumnSidecar).not.toHaveBeenCalled();
      expect(payloadInput.getAllColumns()).toHaveLength(0);
    });

    it("publishes the data columns it has not seen of an envelope that is already known, but not the envelope", async () => {
      const {payloadInput, envelope, blobs, kzgProofs, columnSidecars} = setupBlobs();
      const knownEnvelope = setKnownEnvelope(payloadInput, envelope, columnSidecars);
      const onGossip = vi.fn();
      modules.chain.emitter.on(routes.events.EventType.executionPayloadGossip, onGossip);

      const api = getBeaconBlockApi(defaultApiOptions, modules);
      await expect(
        api.publishExecutionPayloadEnvelope({
          executionPayloadEnvelopeContents: {executionPayloadEnvelope: envelope, kzgProofs, blobs},
          broadcastValidation: routes.beacon.BroadcastValidation.gossip,
        })
      ).resolves.toBeUndefined();

      expect(modules.network.publishExecutionPayloadEnvelope).not.toHaveBeenCalled();
      expect(onGossip).not.toHaveBeenCalled();
      expect(payloadInput.getPayloadEnvelope()).toBe(knownEnvelope);

      const publishedIndices = vi
        .mocked(modules.network.publishDataColumnSidecar)
        .mock.calls.map(([columnSidecar]) => columnSidecar.index);
      expect(publishedIndices).toEqual(
        Array.from({length: NUMBER_OF_COLUMNS - seenColumns}, (_, i) => seenColumns + i)
      );
      expect(payloadInput.getAllColumns()).toHaveLength(NUMBER_OF_COLUMNS);
      // The known envelope was not validated by this request
      expect(modules.chain.processExecutionPayload).toHaveBeenCalledExactlyOnceWith(payloadInput, {
        validEnvelope: false,
      });
    });

    it("rejects an envelope that differs from the known envelope of its block", async () => {
      const {payloadInput, envelope, blobs, kzgProofs, columnSidecars} = setupBlobs();
      setKnownEnvelope(payloadInput, envelope, columnSidecars);
      const otherEnvelope = ssz.gloas.ExecutionPayloadEnvelope.clone(envelope);
      otherEnvelope.payload.gasUsed = 1;

      const api = getBeaconBlockApi(defaultApiOptions, modules);
      await expect(
        api.publishExecutionPayloadEnvelope({
          executionPayloadEnvelopeContents: {executionPayloadEnvelope: otherEnvelope, kzgProofs, blobs},
          broadcastValidation: routes.beacon.BroadcastValidation.gossip,
        })
      ).rejects.toMatchObject({statusCode: 400});

      expect(modules.network.publishExecutionPayloadEnvelope).not.toHaveBeenCalled();
      expect(modules.network.publishDataColumnSidecar).not.toHaveBeenCalled();
      expect(payloadInput.getAllColumns()).toHaveLength(seenColumns);
    });

    it("rejects bad proofs for an envelope that is already known, and neither publishes nor stores a data column", async () => {
      const {payloadInput, envelope, blobs, kzgProofs, columnSidecars} = setupBlobs();
      setKnownEnvelope(payloadInput, envelope, columnSidecars);
      const badKzgProofs = [...kzgProofs.slice(0, -2), ...kzgProofs.slice(-2).reverse()];

      const api = getBeaconBlockApi(defaultApiOptions, modules);
      await expect(
        api.publishExecutionPayloadEnvelope({
          executionPayloadEnvelopeContents: {executionPayloadEnvelope: envelope, kzgProofs: badKzgProofs, blobs},
          broadcastValidation: routes.beacon.BroadcastValidation.gossip,
        })
      ).rejects.toMatchObject({statusCode: 400});

      expect(modules.network.publishDataColumnSidecar).not.toHaveBeenCalled();
      expect(payloadInput.getAllColumns()).toHaveLength(seenColumns);
    });

    it("validates an envelope whose payload is imported and whose PayloadEnvelopeInput is pruned against the block", async () => {
      const {block, payloadInput, envelope, blobs, kzgProofs, columnSidecars} = setupBlobs();
      setKnownEnvelope(payloadInput, envelope, columnSidecars);
      vi.mocked(validateApiExecutionPayloadEnvelope).mockRejectedValueOnce(
        new ExecutionPayloadEnvelopeError(GossipAction.IGNORE, {
          code: ExecutionPayloadEnvelopeErrorCode.ENVELOPE_ALREADY_KNOWN,
          blockRoot: payloadInput.blockRootHex,
          slot: payloadInput.slot,
        })
      );
      vi.mocked(modules.chain.seenPayloadEnvelopeInputCache.get).mockReturnValue(undefined);
      modules.chain.getBlockByRoot.mockResolvedValue({block, executionOptimistic: false, finalized: false});

      const api = getBeaconBlockApi(defaultApiOptions, modules);
      await expect(
        api.publishExecutionPayloadEnvelope({
          executionPayloadEnvelopeContents: {executionPayloadEnvelope: envelope, kzgProofs, blobs},
          broadcastValidation: routes.beacon.BroadcastValidation.gossip,
        })
      ).resolves.toBeUndefined();

      const otherEnvelope = ssz.gloas.ExecutionPayloadEnvelope.clone(envelope);
      otherEnvelope.executionRequests.deposits.push(ssz.electra.DepositRequest.defaultValue());
      await expect(
        api.publishExecutionPayloadEnvelope({
          executionPayloadEnvelopeContents: {executionPayloadEnvelope: otherEnvelope, kzgProofs, blobs},
          broadcastValidation: routes.beacon.BroadcastValidation.gossip,
        })
      ).rejects.toMatchObject({statusCode: 400});

      expect(modules.network.publishExecutionPayloadEnvelope).not.toHaveBeenCalled();
      expect(modules.network.publishDataColumnSidecar).not.toHaveBeenCalled();
    });
  });
});
