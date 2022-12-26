import sinon, {SinonStubbedInstance} from "sinon";
import {expect} from "chai";
import {peerIdFromString} from "@libp2p/peer-id";
import {ssz} from "@lodestar/types";
import {createIBeaconConfig, createIChainForkConfig, defaultChainConfig} from "@lodestar/config";

import {doBeaconBlocksMaybeBlobsByRange, ReqRespBeaconNode} from "../../../src/network/reqresp/index.js";
import {BlockInputType} from "../../../src/chain/blocks/types.js";

describe("doBeaconBlocksMaybeBlobsByRange", function () {
  const sandbox = sinon.createSandbox();
  const reqResp = sandbox.createStubInstance(ReqRespBeaconNode) as SinonStubbedInstance<ReqRespBeaconNode> &
    ReqRespBeaconNode;
  const peerId = peerIdFromString("Qma9T5YraSnpRDZqRR4krcSJabThc8nwZuJV3LercPHufi");

  /* eslint-disable @typescript-eslint/naming-convention */
  const chainConfig = createIChainForkConfig({
    ...defaultChainConfig,
    ALTAIR_FORK_EPOCH: 0,
    BELLATRIX_FORK_EPOCH: 0,
    CAPELLA_FORK_EPOCH: 0,
    EIP4844_FORK_EPOCH: 0,
  });
  const genesisValidatorsRoot = Buffer.alloc(32, 0xaa);
  const config = createIBeaconConfig(chainConfig, genesisValidatorsRoot);
  const rangeRequest = ssz.phase0.BeaconBlocksByRangeRequest.defaultValue();

  const block1 = ssz.eip4844.SignedBeaconBlock.defaultValue();
  block1.message.slot = 1;
  const block2 = ssz.eip4844.SignedBeaconBlock.defaultValue();
  block2.message.slot = 2;

  const blobsSidecar1 = ssz.eip4844.BlobsSidecar.defaultValue();
  blobsSidecar1.beaconBlockSlot = 1;
  const blobsSidecar2 = ssz.eip4844.BlobsSidecar.defaultValue();
  blobsSidecar2.beaconBlockSlot = 2;

  [
    {blocks: [block1], blobsSidecars: [blobsSidecar1], blocksWithBlobs: [{block: block1, blobs: blobsSidecar1}]},
    {
      blocks: [block1, block2],
      blobsSidecars: [blobsSidecar1, blobsSidecar2],
      blocksWithBlobs: [
        {block: block1, blobs: blobsSidecar1},
        {block: block2, blobs: blobsSidecar2},
      ],
    },
  ].map(({blocks, blobsSidecars, blocksWithBlobs}) => {
    it("should match correctly", async () => {
      reqResp.beaconBlocksByRange.resolves(blocks);
      reqResp.blobsSidecarsByRange.resolves(blobsSidecars);

      const response = await doBeaconBlocksMaybeBlobsByRange(config, reqResp, peerId, rangeRequest, 0);
      const expectedResponse = blocksWithBlobs.map(({block, blobs}) => ({
        type: BlockInputType.postEIP4844,
        block,
        blobs,
      }));
      expect(response).to.be.deep.equal(expectedResponse);
    });
  });
});
