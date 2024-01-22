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
      kzg_proofs: ssz.deneb.KZGProofs.toJson(data.kzgProofs),
      blobs: ssz.deneb.Blobs.toJson(data.blobs),
    }),

    fromJson: (data: {signed_block: unknown; kzg_proofs: unknown; blobs: unknown}) => ({
      signedBlock: blockSerializer(data.signed_block as allForks.SignedBeaconBlock).fromJson(data.signed_block),
      kzgProofs: ssz.deneb.KZGProofs.fromJson(data.kzg_proofs),
      blobs: ssz.deneb.Blobs.fromJson(data.blobs),
    }),
  };
}

export function allForksBlockContentsResSerializer(fork: ForkBlobs): TypeJson<allForks.BlockContents> {
  return {
    toJson: (data) => ({
      block: (ssz.allForks[fork].BeaconBlock as allForks.AllForksSSZTypes["BeaconBlock"]).toJson(data.block),
      kzg_proofs: ssz.deneb.KZGProofs.toJson(data.kzgProofs),
      blobs: ssz.deneb.Blobs.toJson(data.blobs),
    }),
    fromJson: (data: {block: unknown; blob_sidecars: unknown; kzg_proofs: unknown; blobs: unknown}) => ({
      block: ssz.allForks[fork].BeaconBlock.fromJson(data.block),
      kzgProofs: ssz.deneb.KZGProofs.fromJson(data.kzg_proofs),
      blobs: ssz.deneb.Blobs.fromJson(data.blobs),
    }),
  };
}
