import {ChainForkConfig} from "@lodestar/config";
import {Db, Repository} from "@lodestar/db";
import {ForkName, isForkPostElectra} from "@lodestar/params";
import {AttesterSlashing, ValidatorIndex, phase0, ssz, sszTypesFor} from "@lodestar/types";
import {Bucket, getBucketNameByValue} from "../buckets.js";

// We add a 1-byte prefix where 0 means pre-electra and 1 means post-electra
enum PrefixByte {
  PRE_ELECTRA = 0,
  POST_ELECTRA = 1,
}

/**
 * AttesterSlashing indexed by root
 *
 * Added via gossip or api
 * Removed when included on chain or old
 */
export class AttesterSlashingRepository extends Repository<Uint8Array, AttesterSlashing> {
  constructor(config: ChainForkConfig, db: Db) {
    const bucket = Bucket.allForks_attesterSlashing;
    const type = ssz.phase0.AttesterSlashing; // Pick some type. Will be overriden
    super(config, db, bucket, type, getBucketNameByValue(bucket));
  }

  async hasAll(attesterIndices: ValidatorIndex[] = []): Promise<boolean> {
    const attesterSlashings = (await this.values()) ?? [];
    const indices = new Set<ValidatorIndex>();
    for (const slashing of attesterSlashings) {
      for (const index of slashing.attestation1.attestingIndices) indices.add(index);
      for (const index of slashing.attestation2.attestingIndices) indices.add(index);
    }
    for (const attesterIndice of attesterIndices) {
      if (!indices.has(attesterIndice)) {
        return false;
      }
    }
    return true;
  }

  encodeValue(value: AttesterSlashing): Uint8Array {
    const slot = Number(value.attestation1.data.slot);
    const fork = this.config.getForkName(slot);

    const type = isForkPostElectra(fork)
      ? sszTypesFor(ForkName.electra).AttesterSlashing
      : sszTypesFor(ForkName.phase0).AttesterSlashing;
    const valueBytes = type.serialize(value);

    // We need to differentiate between post-electra and pre-electra attester slashing
    // such that we can deserialize correctly
    const prefixByte = new Uint8Array(1);
    prefixByte[0] = isForkPostElectra(fork) ? PrefixByte.POST_ELECTRA : PrefixByte.PRE_ELECTRA;

    const prefixedData = new Uint8Array(1 + valueBytes.length);
    prefixedData.set(prefixByte, 0);
    prefixedData.set(valueBytes, 1);

    return prefixedData;
  }

  decodeValue(data: Buffer): AttesterSlashing {
    // First byte is written
    const prefix = data.subarray(0, 1);
    const isPostElectra = prefix[0] === PrefixByte.POST_ELECTRA;

    const type = isPostElectra
      ? sszTypesFor(ForkName.electra).AttesterSlashing
      : sszTypesFor(ForkName.phase0).AttesterSlashing;

    return type.deserialize(data.subarray(1));
  }
}
