import type {INetworkCore} from "../../../src/network/core/types.js";
import {BYTES_PER_BLOB} from "@crate-crypto/node-eth-kzg";
import {Tree} from "@chainsafe/persistent-merkle-tree";
import {BitArray} from "@chainsafe/ssz";
import {describe, expect, it, vi} from "vitest";
import {createBeaconConfig, createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {KZG_COMMITMENTS_GINDEX} from "@lodestar/params";
import {signedBlockToSignedHeader} from "@lodestar/state-transition";
import {fulu, ssz} from "@lodestar/types";
import {GossipType} from "../../../src/network/gossip/interface.js";
import {stringifyGossipTopic} from "../../../src/network/gossip/topic.js";
import {PartialColumnPublisher} from "../../../src/network/partialColumnPublisher.js";
import {PeerIdStr} from "../../../src/util/peerId.js";
import {dataColumnToPartialSidecar} from "../../../src/util/dataColumns.js";
import {kzg} from "../../../src/util/kzg.js";

describe("PartialColumnPublisher", () => {
  function createTestConfig() {
    return createChainForkConfig({
      ...defaultChainConfig,
      CAPELLA_FORK_EPOCH: 0,
      DENEB_FORK_EPOCH: 0,
      ELECTRA_FORK_EPOCH: 0,
      FULU_FORK_EPOCH: 0,
      GLOAS_FORK_EPOCH: Infinity,
    });
  }

  function buildColumnSidecarFixture(chainConfig: ReturnType<typeof createTestConfig>): fulu.DataColumnSidecar {
    const block = ssz.fulu.SignedBeaconBlock.defaultValue();
    block.message.slot = 1;

    const blobs = [
      new Uint8Array(BYTES_PER_BLOB),
      new Uint8Array(BYTES_PER_BLOB).fill(1),
    ];
    const kzgCommitments = blobs.map((blob) => kzg.blobToKzgCommitment(blob));
    block.message.body.blobKzgCommitments = kzgCommitments;

    const signedBlockHeader = signedBlockToSignedHeader(chainConfig, block);
    const bodyView = ssz.fulu.BeaconBlockBody.toView(block.message.body);
    const kzgCommitmentsInclusionProof = new Tree(bodyView.node).getSingleProof(BigInt(KZG_COMMITMENTS_GINDEX));
    const cellsAndProofs = blobs.map((blob) => kzg.computeCellsAndKzgProofs(blob));

    return {
      index: 1,
      column: cellsAndProofs.map(({cells}) => cells[1]),
      kzgCommitments,
      kzgProofs: cellsAndProofs.map(({proofs}) => proofs[1]),
      signedBlockHeader,
      kzgCommitmentsInclusionProof,
    };
  }

  it("should fan out block-production partials once per peer across custody subnets", async () => {
    const chainConfig = createTestConfig();
    const config = createBeaconConfig(chainConfig, new Uint8Array(32));
    const boundary = config.getForkBoundaryAtEpoch(0);
    const published: Array<{peerId: PeerIdStr; partialMessage: Uint8Array; topic: string}> = [];

    const partialPeersByTopic = new Map<string, PeerIdStr[]>([
      [stringifyGossipTopic(config, {type: GossipType.data_column_sidecar, boundary, subnet: 1}), ["peer-a"]],
      [stringifyGossipTopic(config, {type: GossipType.data_column_sidecar, boundary, subnet: 2}), ["peer-a", "peer-b"]],
    ]);
    const core = {
      getPartialPeers: vi.fn(async (topic: string) => partialPeersByTopic.get(topic) ?? []),
      publishPartialMessageToPeer: vi.fn(async (peerId: PeerIdStr, partialMsg) => {
        published.push({peerId, partialMessage: partialMsg.partialMessage, topic: partialMsg.topic});
      }),
    } as Pick<INetworkCore, "getPartialPeers" | "publishPartialMessageToPeer"> as INetworkCore;
    const publisher = new PartialColumnPublisher({config, core, metrics: null});

    const sidecar = buildColumnSidecarFixture(chainConfig);

    await publisher.publishBlockProductionColumns([sidecar], [1, 2], true);

    expect(core.getPartialPeers).toHaveBeenCalledTimes(2);
    expect(published).toHaveLength(2);

    const peerAMessage = published.find(({peerId}) => peerId === "peer-a");
    const peerBMessage = published.find(({peerId}) => peerId === "peer-b");

    if (!peerAMessage || !peerBMessage) {
      expect.fail("Expected both peer-a and peer-b to receive a partial message");
    }

    const fullPartial = ssz.fulu.PartialDataColumnSidecar.deserialize(peerAMessage.partialMessage);
    const headerOnlyPartial = ssz.fulu.PartialDataColumnSidecar.deserialize(peerBMessage.partialMessage);

    expect(peerAMessage.topic).toBe(stringifyGossipTopic(config, {type: GossipType.data_column_sidecar, boundary, subnet: 1}));
    expect(fullPartial.header).toHaveLength(1);
    expect(fullPartial.cellsPresentBitmap.toBoolArray()).toEqual(Array.from({length: sidecar.column.length}, () => true));
    expect(fullPartial.partialColumn).toEqual(sidecar.column);
    expect(fullPartial.kzgProofs).toEqual(sidecar.kzgProofs);

    expect(peerBMessage.topic).toBe(stringifyGossipTopic(config, {type: GossipType.data_column_sidecar, boundary, subnet: 2}));
    expect(headerOnlyPartial.header).toHaveLength(1);
    expect(headerOnlyPartial.cellsPresentBitmap.toBoolArray()).toEqual([]);
    expect(headerOnlyPartial.partialColumn).toEqual([]);
    expect(headerOnlyPartial.kzgProofs).toEqual([]);
  });

  it("should filter partial cells by peer metadata on a subnet", async () => {
    const chainConfig = createTestConfig();
    const config = createBeaconConfig(chainConfig, new Uint8Array(32));
    const boundary = config.getForkBoundaryAtEpoch(0);
    const sidecar = buildColumnSidecarFixture(chainConfig);
    const partialSidecar = dataColumnToPartialSidecar(sidecar, {includeHeader: false, includeCells: true});
    const blockRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(sidecar.signedBlockHeader.message);
    const topic = stringifyGossipTopic(config, {type: GossipType.data_column_sidecar, boundary, subnet: sidecar.index});
    const published: Array<{peerId: PeerIdStr; partialMessage: Uint8Array}> = [];
    const peerMetadata = new Map<PeerIdStr, Uint8Array | undefined>([
      ["peer-a", undefined],
      [
        "peer-b",
        ssz.fulu.PartialDataColumnPartsMetadata.serialize({
          available: BitArray.fromBoolArray([false, true]),
          requests: BitArray.fromBoolArray([true, true]),
        }),
      ],
      [
        "peer-c",
        ssz.fulu.PartialDataColumnPartsMetadata.serialize({
          available: BitArray.fromBoolArray([false, false]),
          requests: BitArray.fromBoolArray([false, false]),
        }),
      ],
    ]);
    const core = {
      getPartialPeers: vi.fn(async (_topic: string) => ["peer-a", "peer-b", "peer-c"]),
      getPeerPartialMetadata: vi.fn(async (_topic: string, _groupId: Uint8Array, peerId: PeerIdStr) => peerMetadata.get(peerId)),
      publishPartialMessageToPeer: vi.fn(async (peerId: PeerIdStr, partialMsg) => {
        published.push({peerId, partialMessage: partialMsg.partialMessage});
      }),
    } as Pick<INetworkCore, "getPartialPeers" | "getPeerPartialMetadata" | "publishPartialMessageToPeer"> as INetworkCore;
    const publisher = new PartialColumnPublisher({config, core, metrics: null});

    await publisher.publishFilteredPartialOnSubnet(
      partialSidecar,
      sidecar.index,
      blockRoot,
      sidecar.signedBlockHeader.message.slot
    );

    expect(core.getPartialPeers).toHaveBeenCalledWith(topic);
    expect(published).toHaveLength(2);

    const peerAMessage = published.find(({peerId}) => peerId === "peer-a");
    const peerBMessage = published.find(({peerId}) => peerId === "peer-b");

    if (!peerAMessage || !peerBMessage) {
      expect.fail("Expected peer-a and peer-b to receive filtered partial messages");
    }

    const unfilteredPartial = ssz.fulu.PartialDataColumnSidecar.deserialize(peerAMessage.partialMessage);
    const filteredPartial = ssz.fulu.PartialDataColumnSidecar.deserialize(peerBMessage.partialMessage);

    expect(unfilteredPartial.cellsPresentBitmap.toBoolArray()).toEqual([true, true]);
    expect(unfilteredPartial.partialColumn).toEqual(sidecar.column);

    expect(filteredPartial.cellsPresentBitmap.toBoolArray()).toEqual([true, false]);
    expect(filteredPartial.partialColumn).toEqual([sidecar.column[0]]);
    expect(filteredPartial.kzgProofs).toEqual([sidecar.kzgProofs[0]]);
  });
});
