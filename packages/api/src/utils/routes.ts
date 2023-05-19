import {allForks, deneb, ssz} from "@lodestar/types";
import {ForkBlobs} from "@lodestar/params";

import {TypeJson} from "./types.js";

export type BlockContents = {block: allForks.BeaconBlock; blobSidecars: deneb.BlobSidecars};
export type SignedBlockContents = {
  signedBlock: allForks.SignedBeaconBlock;
  signedBlobSidecars: deneb.SignedBlobSidecars;
};

export type BlindedBlockContents = {
  blindedBlock: allForks.BlindedBeaconBlock;
  blindedBlobSidecars: deneb.BlindedBlobSidecars;
};
export type SignedBlindedBlockContents = {
  signedBlindedBlock: allForks.SignedBlindedBeaconBlock;
  signedBlindedBlobSidecars: deneb.SignedBlindedBlobSidecars;
};

export function isBlockContents(data: allForks.BeaconBlock | BlockContents): data is BlockContents {
  return (data as BlockContents).blobSidecars !== undefined;
}

export function isSignedBlockContents(
  data: allForks.SignedBeaconBlock | SignedBlockContents
): data is SignedBlockContents {
  return (data as SignedBlockContents).signedBlobSidecars !== undefined;
}

export function isBlindedBlockContents(
  data: allForks.BlindedBeaconBlock | BlindedBlockContents
): data is BlindedBlockContents {
  return (data as BlindedBlockContents).blindedBlobSidecars !== undefined;
}

export function isSignedBlindedBlockContents(
  data: allForks.SignedBlindedBeaconBlock | SignedBlindedBlockContents
): data is SignedBlindedBlockContents {
  return (data as SignedBlindedBlockContents).signedBlindedBlobSidecars !== undefined;
}

/* eslint-disable @typescript-eslint/naming-convention */

export function AllForksSignedBlockContentsReqSerializer(
  blockSerializer: (data: allForks.SignedBeaconBlock) => TypeJson<allForks.SignedBeaconBlock>
): TypeJson<SignedBlockContents> {
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

export function AllForksBlockContentsResSerializer(getType: () => ForkBlobs): TypeJson<BlockContents> {
  return {
    toJson: (data) => ({
      block: (ssz.allForks[getType()].BeaconBlock as allForks.AllForksSSZTypes["BeaconBlock"]).toJson(data.block),
      blob_sidecars: ssz.deneb.BlobSidecars.toJson(data.blobSidecars),
    }),
    fromJson: (data: {block: unknown; blob_sidecars: unknown}) => ({
      block: ssz.allForks[getType()].BeaconBlock.fromJson(data.block),
      blobSidecars: ssz.deneb.BlobSidecars.fromJson(data.blob_sidecars),
    }),
  };
}

export function AllForksSignedBlindedBlockContentsReqSerializer(
  blockSerializer: (data: allForks.SignedBlindedBeaconBlock) => TypeJson<allForks.SignedBlindedBeaconBlock>
): TypeJson<SignedBlindedBlockContents> {
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

export function AllForksBlindedBlockContentsResSerializer(getType: () => ForkBlobs): TypeJson<BlindedBlockContents> {
  return {
    toJson: (data) => ({
      blinded_block: (
        ssz.allForksBlinded[getType()].BeaconBlock as allForks.AllForksBlindedSSZTypes["BeaconBlock"]
      ).toJson(data.blindedBlock),
      blinded_blob_sidecars: ssz.deneb.BlindedBlobSidecars.toJson(data.blindedBlobSidecars),
    }),
    fromJson: (data: {blinded_block: unknown; blinded_blob_sidecars: unknown}) => ({
      blindedBlock: ssz.allForksBlinded[getType()].BeaconBlock.fromJson(data.blinded_block),
      blindedBlobSidecars: ssz.deneb.BlindedBlobSidecars.fromJson(data.blinded_blob_sidecars),
    }),
  };
}
