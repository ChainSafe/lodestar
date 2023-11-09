import {allForks, ssz} from "@lodestar/types";
import {ForkBlobs} from "@lodestar/params";

import {TypeJson} from "./types.js";

/* eslint-disable @typescript-eslint/naming-convention */

export function allForksSignedBlockContentsReqSerializer(
  blockSerializer: (data: allForks.SignedBeaconBlock) => TypeJson<allForks.SignedBeaconBlock>
): TypeJson<allForks.SignedBlockContents> {
  return {
    toJson: (data) => ({
      signed_block: blockSerializer(data.signedBlock).toJson(data.signedBlock),
      signed_blob_sidecars: ssz.deneb.SignedBlobSidecars.toJson(data.signedBlobSidecars),
    }),

    fromJson: (data: {signed_block: unknown; signed_blob_sidecars: unknown}) => ({
      signedBlock: blockSerializer(data.signed_block as allForks.SignedBeaconBlock).fromJson(data.signed_block),
      signedBlobSidecars: ssz.deneb.SignedBlobSidecars.fromJson(data.signed_blob_sidecars),
    }),
  };
}

export function allForksBlockContentsResSerializer(fork: ForkBlobs): TypeJson<allForks.BlockContents> {
  return {
    toJson: (data) => ({
      block: (ssz.allForks[fork].BeaconBlock as allForks.AllForksSSZTypes["BeaconBlock"]).toJson(data.block),
      blob_sidecars: ssz.deneb.BlobSidecars.toJson(data.blobSidecars),
    }),
    fromJson: (data: {block: unknown; blob_sidecars: unknown}) => ({
      block: ssz.allForks[fork].BeaconBlock.fromJson(data.block),
      blobSidecars: ssz.deneb.BlobSidecars.fromJson(data.blob_sidecars),
    }),
  };
}

export function allForksSignedBlindedBlockContentsReqSerializer(
  blockSerializer: (data: allForks.SignedBlindedBeaconBlock) => TypeJson<allForks.SignedBlindedBeaconBlock>
): TypeJson<allForks.SignedBlindedBlockContents> {
  return {
    toJson: (data) => ({
      signed_blinded_block: blockSerializer(data.signedBlindedBlock).toJson(data.signedBlindedBlock),
      signed_blinded_blob_sidecars: ssz.deneb.SignedBlindedBlobSidecars.toJson(data.signedBlindedBlobSidecars),
    }),

    fromJson: (data: {signed_blinded_block: unknown; signed_blinded_blob_sidecars: unknown}) => ({
      signedBlindedBlock: blockSerializer(data.signed_blinded_block as allForks.SignedBlindedBeaconBlock).fromJson(
        data.signed_blinded_block
      ),
      signedBlindedBlobSidecars: ssz.deneb.SignedBlindedBlobSidecars.fromJson(data.signed_blinded_blob_sidecars),
    }),
  };
}

export function allForksBlindedBlockContentsResSerializer(fork: ForkBlobs): TypeJson<allForks.BlindedBlockContents> {
  return {
    toJson: (data) => ({
      blinded_block: (ssz.allForksBlinded[fork].BeaconBlock as allForks.AllForksBlindedSSZTypes["BeaconBlock"]).toJson(
        data.blindedBlock
      ),
      blinded_blob_sidecars: ssz.deneb.BlindedBlobSidecars.toJson(data.blindedBlobSidecars),
    }),
    fromJson: (data: {blinded_block: unknown; blinded_blob_sidecars: unknown}) => ({
      blindedBlock: ssz.allForksBlinded[fork].BeaconBlock.fromJson(data.blinded_block),
      blindedBlobSidecars: ssz.deneb.BlindedBlobSidecars.fromJson(data.blinded_blob_sidecars),
    }),
  };
}
