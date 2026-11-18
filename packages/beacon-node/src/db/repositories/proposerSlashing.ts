import {ChainForkConfig} from "@lodestar/config";
import {BUCKET_LENGTH, Db, Repository} from "@lodestar/db";
import {XMSS_SIGNATURE_SIZE} from "@lodestar/params";
import {ValidatorIndex, phase0, ssz} from "@lodestar/types";
import {bytesToInt} from "@lodestar/utils";
import {Bucket, getBucketNameByValue} from "../buckets.js";

export class ProposerSlashingRepository extends Repository<ValidatorIndex, phase0.ProposerSlashing> {
  constructor(config: ChainForkConfig, db: Db) {
    const bucket = Bucket.phase0_proposerSlashing;
    super(config, db, bucket, ssz.phase0.ProposerSlashing, getBucketNameByValue(bucket));
  }

  // From pq a slashing's signatures are leanXMSS ones, which are longer: its size says which type it is
  encodeValue(value: phase0.ProposerSlashing): Uint8Array {
    return value.signedHeader1.signature.length === XMSS_SIGNATURE_SIZE
      ? ssz.pq.ProposerSlashing.serialize(value)
      : ssz.phase0.ProposerSlashing.serialize(value);
  }

  decodeValue(data: Uint8Array): phase0.ProposerSlashing {
    return data.length === ssz.pq.ProposerSlashing.fixedSize
      ? ssz.pq.ProposerSlashing.deserialize(data)
      : ssz.phase0.ProposerSlashing.deserialize(data);
  }

  getId(value: phase0.ProposerSlashing): ValidatorIndex {
    return value.signedHeader1.message.proposerIndex;
  }

  decodeKey(data: Uint8Array): ValidatorIndex {
    return bytesToInt(data.subarray(BUCKET_LENGTH), "be");
  }
}
