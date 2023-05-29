import {expect} from "chai";
import {ssz, deneb} from "@lodestar/types";
import {createBeaconConfig, createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {BYTES_PER_FIELD_ELEMENT} from "@lodestar/params";

import {beaconBlocksMaybeBlobsByRange} from "../../../src/network/reqresp/index.js";
import {BlockInputType, BlockSource, blobSidecarsToBlobsSidecar} from "../../../src/chain/blocks/types.js";
import {ckzg, initCKZG, loadEthereumTrustedSetup, FIELD_ELEMENTS_PER_BLOB_MAINNET} from "../../../src/util/kzg.js";
import {INetwork} from "../../../src/network/interface.js";
import {ZERO_HASH} from "../../../src/constants/constants.js";

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
  block1.message.body.blobKzgCommitments.push(ssz.deneb.KZGCommitment.defaultValue());
  const blobSidecar1 = ssz.deneb.BlobSidecar.defaultValue();
  blobSidecar1.slot = 1;

  const block2 = ssz.deneb.SignedBeaconBlock.defaultValue();
  block2.message.slot = 2;
  block2.message.body.blobKzgCommitments.push(ssz.deneb.KZGCommitment.defaultValue());
  const blobSidecar2 = ssz.deneb.BlobSidecar.defaultValue();
  blobSidecar2.slot = 2;

  const block3 = ssz.deneb.SignedBeaconBlock.defaultValue();
  block3.message.slot = 3;
  // no blobsidecar for block3

  const block4 = ssz.deneb.SignedBeaconBlock.defaultValue();
  block4.message.slot = 4;
  // two blobsidecars
  block4.message.body.blobKzgCommitments.push(ssz.deneb.KZGCommitment.defaultValue());
  block4.message.body.blobKzgCommitments.push(ssz.deneb.KZGCommitment.defaultValue());
  const blobSidecar41 = ssz.deneb.BlobSidecar.defaultValue();
  blobSidecar41.slot = 4;
  const blobSidecar42 = ssz.deneb.BlobSidecar.defaultValue();
  blobSidecar42.slot = 4;
  blobSidecar42.index = 1;

  // Array of testcases which are array of matched blocks with/without (if empty) sidecars
  const testCases: [string, [deneb.SignedBeaconBlock, deneb.BlobSidecar[] | undefined][]][] = [
    ["one block with sidecar", [[block1, [blobSidecar1]]]],
    [
      "two blocks with sidecar",
      [
        [block1, [blobSidecar1]],
        [block2, [blobSidecar2]],
      ],
    ],
    ["block with skipped sidecar", [[block3, undefined]]],
    ["multiple blob sidecars per block", [[block4, [blobSidecar41, blobSidecar42]]]],
    [
      "all blocks together",
      [
        [block1, [blobSidecar1]],
        [block2, [blobSidecar2]],
        [block3, undefined],
        [block4, [blobSidecar41, blobSidecar42]],
      ],
    ],
  ];
  testCases.map(([testName, blocksWithBlobs]) => {
    it(testName, async () => {
      const blocks = blocksWithBlobs.map(([block, _blobs]) => block);

      const blobSidecars = blocksWithBlobs
        .map(([_block, blobs]) => blobs as deneb.BlobSidecars)
        .filter((blobs) => blobs !== undefined)
        .reduce((acc, elem) => acc.concat(elem), []);

      const expectedResponse = blocksWithBlobs.map(([block, blobSidecars]) => {
        const blobs = (blobSidecars !== undefined ? blobSidecars : []).map((bscar) => {
          // TODO DENEB: cleanup the following generation as its not required to generate
          // proper field elements for the aggregate proofs compute
          bscar.blob = generateRandomBlob();
          (bscar.kzgCommitment = ckzg.blobToKzgCommitment(bscar.blob)),
            (bscar.kzgProof = ckzg.computeAggregateKzgProof([bscar.blob]));
          return bscar;
        });
        return {
          type: BlockInputType.postDeneb,
          block,
          source: BlockSource.byRange,
          // TODO DENEB: Cleanup the conversion once migration complete
          blobs: blobSidecarsToBlobsSidecar(chainConfig, block, blobs),
        };
      });

      const network = {
        sendBeaconBlocksByRange: async () => blocks.map((data) => ({data, bytes: ZERO_HASH})),
        sendBlobSidecarsByRange: async () => blobSidecars,
      } as Partial<INetwork> as INetwork;

      const response = await beaconBlocksMaybeBlobsByRange(config, network, peerId, rangeRequest, 0);
      expect(response).to.be.deep.equal(expectedResponse);
    });
  });
});

function generateRandomBlob(): deneb.Blob {
  const blob = new Uint8Array(FIELD_ELEMENTS_PER_BLOB_MAINNET * BYTES_PER_FIELD_ELEMENT);
  const dv = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  for (let i = 0; i < FIELD_ELEMENTS_PER_BLOB_MAINNET; i++) {
    dv.setUint32(i * BYTES_PER_FIELD_ELEMENT, i);
  }
  return blob;
}
