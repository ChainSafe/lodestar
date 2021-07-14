import {deserializeProof, Proof, serializeProof} from "@chainsafe/persistent-merkle-tree";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {Bucket, IDatabaseController, IDbMetrics, Repository} from "@chainsafe/lodestar-db";
import {Type} from "@chainsafe/ssz";

export class LightClientInitProofRepository extends Repository<number, Proof> {
  constructor(config: IChainForkConfig, db: IDatabaseController<Buffer, Buffer>, metrics?: IDbMetrics) {
    super(config, db, Bucket.altair_lightClientInitProof, (undefined as unknown) as Type<Proof>, metrics);
  }

  encodeValue(value: Proof): Buffer {
    return Buffer.from(serializeProof(value));
  }

  decodeValue(data: Uint8Array): Proof {
    return deserializeProof(data);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  getId(value: Proof): number {
    throw new Error("Cannot get the db key from a proof");
  }
}

export class LightClientSyncCommitteeProofRepository extends Repository<number, Proof> {
  constructor(config: IChainForkConfig, db: IDatabaseController<Buffer, Buffer>, metrics?: IDbMetrics) {
    super(config, db, Bucket.altair_lightClientSyncCommitteeProof, (undefined as unknown) as Type<Proof>, metrics);
  }

  encodeValue(value: Proof): Buffer {
    return Buffer.from(serializeProof(value));
  }

  decodeValue(data: Uint8Array): Proof {
    return deserializeProof(data);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  getId(value: Proof): number {
    throw new Error("Cannot get the db key from a proof");
  }
}
