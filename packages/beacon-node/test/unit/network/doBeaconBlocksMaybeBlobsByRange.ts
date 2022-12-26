import sinon, {SinonStubbedInstance} from "sinon";
import {expect} from "chai";
import {peerIdFromString} from "@libp2p/peer-id";
import {ssz, eip4844} from "@lodestar/types";
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
  const emptyKzgAggregatedProof = ssz.eip4844.BlobsSidecar.defaultValue().kzgAggregatedProof;

  const block1 = ssz.eip4844.SignedBeaconBlock.defaultValue();
  block1.message.slot = 1;
  const block2 = ssz.eip4844.SignedBeaconBlock.defaultValue();
  block2.message.slot = 2;

  const blobsSidecar1 = ssz.eip4844.BlobsSidecar.defaultValue();
  blobsSidecar1.beaconBlockSlot = 1;
  const blobsSidecar2 = ssz.eip4844.BlobsSidecar.defaultValue();
  blobsSidecar2.beaconBlockSlot = 2;

  // Array of testcases which are array of matched blocks with/without (if empty) sidecars
  const testCases: [string, [eip4844.SignedBeaconBlock, eip4844.BlobsSidecar | undefined][]][] = [
    ["one block with sidecar", [[block1, blobsSidecar1]]],
    [
      "two blocks with sidecar",
      [
        [block1, blobsSidecar1],
        [block2, blobsSidecar2],
      ],
    ],
    ["block with skipped sidecar", [[block1, undefined]]],
  ];
  testCases.map(([testName, blocksWithBlobs]) => {
    it(testName, async () => {
      const blocks = blocksWithBlobs.map(([block, _blobs]) => block as eip4844.SignedBeaconBlock);
      const blobsSidecars = blocksWithBlobs
        .map(([_block, blobs]) => blobs as eip4844.BlobsSidecar)
        .filter((blobs) => blobs !== undefined);

      const expectedResponse = blocksWithBlobs.map(([block, blobsSidecar]) => {
        const blobs =
          blobsSidecar !== undefined
            ? blobsSidecar
            : {
                beaconBlockRoot: ssz.eip4844.BeaconBlock.hashTreeRoot(block.message),
                beaconBlockSlot: block.message.slot,
                blobs: [],
                kzgAggregatedProof: emptyKzgAggregatedProof,
              };
        return {
          type: BlockInputType.postEIP4844,
          block,
          blobs,
        };
      });
      reqResp.beaconBlocksByRange.resolves(blocks);
      reqResp.blobsSidecarsByRange.resolves(blobsSidecars);

      const response = await doBeaconBlocksMaybeBlobsByRange(
        config,
        reqResp,
        peerId,
        rangeRequest,
        0,
        emptyKzgAggregatedProof
      );
      expect(response).to.be.deep.equal(expectedResponse);
    });
  });
});
