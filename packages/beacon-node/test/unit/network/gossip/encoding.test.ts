import {describe, expect, it} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {config as chainConfig} from "@lodestar/config/default";
import {ForkName, ZERO_HASH} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {DataColumnSidecar} from "@lodestar/types/fulu";
import {DataTransformSnappy, globalInboundCache} from "../../../../src/network/gossip/encoding.js";
import {GossipEncoding, GossipTopic, GossipType} from "../../../../src/network/gossip/interface.js";
import {compress} from "../../../../src/network/gossip/snappy/index.js";
import {GossipTopicCache} from "../../../../src/network/gossip/topic.js";
import {kzg} from "../../../../src/util/kzg.js";
import {generateRandomBlob} from "../../../utils/kzg.js";

describe("DataTransformSnappy", () => {
  const config = createBeaconConfig(chainConfig, ZERO_HASH);
  const topic: GossipTopic = {
    type: GossipType.data_column_sidecar,
    subnet: 1,
    boundary: {fork: ForkName.fulu, epoch: config.FULU_FORK_EPOCH},
    encoding: GossipEncoding.ssz_snappy,
  };
  const topicStr = "/eth2/4ba67af9/data_column_sidecar_1/ssz_snappy";
  const gossipTopicCache = new GossipTopicCache(config);
  gossipTopicCache.setTopic(topicStr, topic);

  it("uncompress DataColumnSidecar using buffer pool", () => {
    const dataTransform = new DataTransformSnappy(gossipTopicCache, 1e9, config);
    const maxBlobs = config.getMaxBlobsPerBlock(config.FULU_FORK_EPOCH);
    // this is not max data size but DataTransformSnappy should still alloc max size buffer and use it for later messages
    const data = createDataColumnSidecarSsz(maxBlobs - 2);
    expect(globalInboundCache.get(GossipType.data_column_sidecar)?.size()).toBe(0);
    expect(dataTransform.allocByTopicType.get(GossipType.data_column_sidecar)).toBeUndefined();
    const compressed = compress(data);
    const uncompressed = dataTransform.inboundTransform(topicStr, compressed);
    expect(uncompressed).toEqual(data);
    expect(dataTransform.allocByTopicType.get(GossipType.data_column_sidecar)).toBe(1);

    // add to pool, this simulates the gossipsub behavior after emitting msg to the main thread
    globalInboundCache.get(GossipType.data_column_sidecar)?.add(uncompressed.buffer as ArrayBuffer);
    expect(globalInboundCache.get(GossipType.data_column_sidecar)?.size()).toBe(1);

    // new message comes, no need to alloc a new buffer
    const maxData = createDataColumnSidecarSsz(maxBlobs);
    const compressed2 = compress(maxData);
    const uncompressed2 = dataTransform.inboundTransform(topicStr, compressed2);
    expect(uncompressed2).toEqual(maxData);
    // no need to alloc again
    expect(dataTransform.allocByTopicType.get(GossipType.data_column_sidecar)).toBe(1);
    // we used the buffer from pool so its size is now 0
    expect(globalInboundCache.get(GossipType.data_column_sidecar)?.size()).toBe(0);
  });
});

function createDataColumnSidecarSsz(blobs: number): Uint8Array {
  return ssz.fulu.DataColumnSidecar.serialize(createDataColumnSidecar(blobs));
}

function createDataColumnSidecar(numberOfBlobs: number): DataColumnSidecar {
  const blobs = Array.from({length: numberOfBlobs}, () => generateRandomBlob());
  const kzgCommitments = blobs.map((blob) => kzg.blobToKzgCommitment(blob));
  const cellsAndProofs = blobs.map((blob) => kzg.computeCellsAndKzgProofs(blob));
  const columnIndex = 10;
  const dataColumnSidecar: DataColumnSidecar = {
    index: columnIndex,
    column: Array.from({length: numberOfBlobs}, (_, rowNumber) => cellsAndProofs[rowNumber].cells[columnIndex]),
    kzgCommitments,
    kzgProofs: Array.from({length: numberOfBlobs}, (_, rowNumber) => cellsAndProofs[rowNumber].proofs[columnIndex]),
    signedBlockHeader: ssz.phase0.SignedBeaconBlockHeader.defaultValue(),
    kzgCommitmentsInclusionProof: ssz.fulu.KzgCommitmentsInclusionProof.defaultValue(),
  };
  return dataColumnSidecar;
}
