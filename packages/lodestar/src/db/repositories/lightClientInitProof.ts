import {deserializeProof, Proof, serializeProof} from "@chainsafe/persistent-merkle-tree";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {Bucket, IDatabaseController, IDbMetrics, Repository} from "@chainsafe/lodestar-db";
import {Type} from "@chainsafe/ssz";

export class LightClientInitProofRepository extends Repository<Uint8Array, Proof> {
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
  getId(value: Proof): Uint8Array {
    throw new Error("Cannot get the db key from a proof");
  }
}

export class LightClientInitProofIndexRepository extends Repository<Uint8Array, boolean> {
  constructor(config: IChainForkConfig, db: IDatabaseController<Buffer, Buffer>, metrics?: IDbMetrics) {
    super(config, db, Bucket.index_lightClientInitProof, (undefined as unknown) as Type<boolean>, metrics);
  }

  encodeValue(_value: boolean): Buffer {
    return Buffer.from([1]);
  }

  decodeValue(_data: Uint8Array): boolean {
    return true;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  getId(value: boolean): Uint8Array {
    throw new Error("Cannot get the db key from a value");
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
