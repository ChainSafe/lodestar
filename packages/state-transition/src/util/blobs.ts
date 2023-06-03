import SHA256 from "@chainsafe/as-sha256";
import {VERSIONED_HASH_VERSION_KZG} from "@lodestar/params";
import {deneb} from "@lodestar/types";

type VersionHash = Uint8Array;

export function kzgCommitmentToVersionedHash(kzgCommitment: deneb.KZGCommitment): VersionHash {
  const hash = SHA256.digest(kzgCommitment);
  // Equivalent to `VERSIONED_HASH_VERSION_KZG + hash(kzg_commitment)[1:]`
  hash[0] = VERSIONED_HASH_VERSION_KZG;
  return hash;
}
