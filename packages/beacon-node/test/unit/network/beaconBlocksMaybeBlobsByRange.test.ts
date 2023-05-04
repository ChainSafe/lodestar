import {expect} from "chai";
import {ssz, deneb} from "@lodestar/types";
import {createBeaconConfig, createChainForkConfig, defaultChainConfig} from "@lodestar/config";

import {beaconBlocksMaybeBlobsByRange} from "../../../src/network/reqresp/index.js";
import {BlockInputType} from "../../../src/chain/blocks/types.js";
import {ckzg, initCKZG, loadEthereumTrustedSetup} from "../../../src/util/kzg.js";
import {INetwork} from "../../../src/network/interface.js";

describe("beaconBlocksMaybeBlobsByRange", () => {
  before(async function () {
    this.timeout(10000); // Loading trusted setup is slow
    await initCKZG();
    loadEthereumTrustedSetup();
  });

  const peerId = "Qma9T5YraSnpRDZqRR4krcSJabThc8nwZuJV3LercPHufi";

  /* eslint-disable @typescript-eslint/naming-convention */
  const chainConfig = createChainForkConfig({
    ...defaultChainConfig,
    ALTAIR_FORK_EPOCH: 0,
    BELLATRIX_FORK_EPOCH: 0,
    CAPELLA_FORK_EPOCH: 0,
    DENEB_FORK_EPOCH: 0,
  });
  const genesisValidatorsRoot = Buffer.alloc(32, 0xaa);
  const config = createBeaconConfig(chainConfig, genesisValidatorsRoot);
  const rangeRequest = ssz.phase0.BeaconBlocksByRangeRequest.defaultValue();
  rangeRequest.count = 1;

  const block1 = ssz.deneb.SignedBeaconBlock.defaultValue();
  block1.message.slot = 1;
  const block2 = ssz.deneb.SignedBeaconBlock.defaultValue();
  block2.message.slot = 2;

  const blobsSidecar1 = ssz.deneb.BlobsSidecar.defaultValue();
  blobsSidecar1.beaconBlockSlot = 1;
  const blobsSidecar2 = ssz.deneb.BlobsSidecar.defaultValue();
  blobsSidecar2.beaconBlockSlot = 2;

  // Array of testcases which are array of matched blocks with/without (if empty) sidecars
  const testCases: [string, [deneb.SignedBeaconBlock, deneb.BlobsSidecar | undefined][]][] = [
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
      const blocks = blocksWithBlobs.map(([block, _blobs]) => block as deneb.SignedBeaconBlock);
      const blobsSidecars = blocksWithBlobs
        .map(([_block, blobs]) => blobs as deneb.BlobsSidecar)
        .filter((blobs) => blobs !== undefined);
      const emptyKzgAggregatedProof = ckzg.computeAggregateKzgProof([]);
      const expectedResponse = blocksWithBlobs.map(([block, blobsSidecar]) => {
        const blobs =
          blobsSidecar !== undefined
            ? blobsSidecar
            : {
                beaconBlockRoot: ssz.deneb.BeaconBlock.hashTreeRoot(block.message),
                beaconBlockSlot: block.message.slot,
                blobs: [],
                kzgAggregatedProof: emptyKzgAggregatedProof,
              };
        return {
          type: BlockInputType.postDeneb,
          block,
          blobs,
        };
      });

      const network = {
        sendBeaconBlocksByRange: async () => blocks,
        sendBlobsSidecarsByRange: async () => blobsSidecars,
      } as Partial<INetwork> as INetwork;

      const response = await beaconBlocksMaybeBlobsByRange(config, network, peerId, rangeRequest, 0);
      expect(response).to.be.deep.equal(expectedResponse);
    });
  });
});
