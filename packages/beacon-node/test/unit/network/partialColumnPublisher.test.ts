import type {INetworkCore} from "../../../src/network/core/types.js";
import {BYTES_PER_BLOB} from "@crate-crypto/node-eth-kzg";
import {Tree} from "@chainsafe/persistent-merkle-tree";
import {describe, expect, it, vi} from "vitest";
import {createBeaconConfig, createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {KZG_COMMITMENTS_GINDEX} from "@lodestar/params";
import {signedBlockToSignedHeader} from "@lodestar/state-transition";
import {fulu, ssz} from "@lodestar/types";
import {GossipType} from "../../../src/network/gossip/interface.js";
import {stringifyGossipTopic} from "../../../src/network/gossip/topic.js";
import {PartialColumnPublisher} from "../../../src/network/partialColumnPublisher.js";
import {PeerIdStr} from "../../../src/util/peerId.js";
import {kzg} from "../../../src/util/kzg.js";

describe("PartialColumnPublisher", () => {
  it("should fan out block-production partials once per peer across custody subnets", async () => {
    const chainConfig = createChainForkConfig({
      ...defaultChainConfig,
      CAPELLA_FORK_EPOCH: 0,
      DENEB_FORK_EPOCH: 0,
      ELECTRA_FORK_EPOCH: 0,
      FULU_FORK_EPOCH: 0,
      GLOAS_FORK_EPOCH: Infinity,
    });
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

    const sidecar: fulu.DataColumnSidecar = {
      index: 1,
      column: cellsAndProofs.map(({cells}) => cells[1]),
      kzgCommitments,
      kzgProofs: cellsAndProofs.map(({proofs}) => proofs[1]),
      signedBlockHeader,
      kzgCommitmentsInclusionProof,
    };

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
});
