import {ContainerType, VectorCompositeType} from "@chainsafe/ssz";
import {ChainForkConfig} from "@lodestar/config";
import {DatabaseController, Repository} from "@lodestar/db";
import {CURRENT_SYNC_COMMITTEE_DEPTH_GLOAS, NEXT_SYNC_COMMITTEE_DEPTH_GLOAS} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {SyncCommitteeWitness} from "../../chain/lightClient/types.js";
import {Bucket, getBucketNameByValue} from "../buckets.js";

// We add a 1-byte prefix where 0 means pre-Electra, 1 means post-Electra, and 2 means post-Gloas.
enum PrefixByte {
  PRE_ELECTRA = 0,
  POST_ELECTRA = 1,
  POST_GLOAS = 2,
}

export const NUM_WITNESS = 4;
export const NUM_WITNESS_ELECTRA = 5;

/**
 * Historical sync committees witness by block root
 *
 * Used to prepare lightclient updates and initial snapshots
 */
export class SyncCommitteeWitnessRepository extends Repository<Uint8Array, SyncCommitteeWitness> {
  constructor(config: ChainForkConfig, db: DatabaseController<Uint8Array, Uint8Array>) {
    const bucket = Bucket.lightClient_syncCommitteeWitness;
    // Pick some type but won't be used. Witness can be 4 or 5 so need to handle dynamically
    const type = new ContainerType({
      witness: new VectorCompositeType(ssz.Root, NUM_WITNESS),
      currentSyncCommitteeRoot: ssz.Root,
      nextSyncCommitteeRoot: ssz.Root,
    });

    super(config, db, bucket, type, getBucketNameByValue(bucket));
  }

  // Overrides for multi-fork
  encodeValue(value: SyncCommitteeWitness): Uint8Array {
    const numWitness = value.witness.length;
    const hasGloasBranches =
      value.currentSyncCommitteeBranch !== undefined || value.nextSyncCommitteeBranch !== undefined;

    if (hasGloasBranches) {
      if (
        value.currentSyncCommitteeBranch?.length !== CURRENT_SYNC_COMMITTEE_DEPTH_GLOAS ||
        value.nextSyncCommitteeBranch?.length !== NEXT_SYNC_COMMITTEE_DEPTH_GLOAS
      ) {
        throw Error(
          `Invalid post-Gloas sync committee branch lengths current=${value.currentSyncCommitteeBranch?.length} next=${value.nextSyncCommitteeBranch?.length}`
        );
      }

      const type = new ContainerType({
        currentSyncCommitteeBranch: new VectorCompositeType(ssz.Root, CURRENT_SYNC_COMMITTEE_DEPTH_GLOAS),
        nextSyncCommitteeBranch: new VectorCompositeType(ssz.Root, NEXT_SYNC_COMMITTEE_DEPTH_GLOAS),
        currentSyncCommitteeRoot: ssz.Root,
        nextSyncCommitteeRoot: ssz.Root,
      });

      const valueBytes = type.serialize({
        currentSyncCommitteeBranch: value.currentSyncCommitteeBranch,
        nextSyncCommitteeBranch: value.nextSyncCommitteeBranch,
        currentSyncCommitteeRoot: value.currentSyncCommitteeRoot,
        nextSyncCommitteeRoot: value.nextSyncCommitteeRoot,
      });

      return prefixData(PrefixByte.POST_GLOAS, valueBytes);
    }

    if (numWitness !== NUM_WITNESS && numWitness !== NUM_WITNESS_ELECTRA) {
      throw Error(`Number of witness can only be 4 pre-electra or 5 post-electra numWitness=${numWitness}`);
    }

    const type = new ContainerType({
      witness: new VectorCompositeType(ssz.Root, numWitness),
      currentSyncCommitteeRoot: ssz.Root,
      nextSyncCommitteeRoot: ssz.Root,
    });

    const valueBytes = type.serialize(value);

    // We need to differentiate between post-electra and pre-electra witness
    // such that we can deserialize correctly
    const isPostElectra = numWitness === NUM_WITNESS_ELECTRA;
    return prefixData(isPostElectra ? PrefixByte.POST_ELECTRA : PrefixByte.PRE_ELECTRA, valueBytes);
  }

  decodeValue(data: Uint8Array): SyncCommitteeWitness {
    // First byte is written
    const prefix = data.subarray(0, 1);
    const isPostGloas = prefix[0] === PrefixByte.POST_GLOAS;

    if (isPostGloas) {
      const type = new ContainerType({
        currentSyncCommitteeBranch: new VectorCompositeType(ssz.Root, CURRENT_SYNC_COMMITTEE_DEPTH_GLOAS),
        nextSyncCommitteeBranch: new VectorCompositeType(ssz.Root, NEXT_SYNC_COMMITTEE_DEPTH_GLOAS),
        currentSyncCommitteeRoot: ssz.Root,
        nextSyncCommitteeRoot: ssz.Root,
      });

      return {witness: [], ...type.deserialize(data.subarray(1))};
    }

    const isPostElectra = prefix[0] === PrefixByte.POST_ELECTRA;

    const type = new ContainerType({
      witness: new VectorCompositeType(ssz.Root, isPostElectra ? NUM_WITNESS_ELECTRA : NUM_WITNESS),
      currentSyncCommitteeRoot: ssz.Root,
      nextSyncCommitteeRoot: ssz.Root,
    });

    return type.deserialize(data.subarray(1));
  }
}

function prefixData(prefix: PrefixByte, valueBytes: Uint8Array): Uint8Array {
  const prefixByte = new Uint8Array(1);
  prefixByte[0] = prefix;

  const prefixedData = new Uint8Array(1 + valueBytes.length);
  prefixedData.set(prefixByte, 0);
  prefixedData.set(valueBytes, 1);

  return prefixedData;
}
