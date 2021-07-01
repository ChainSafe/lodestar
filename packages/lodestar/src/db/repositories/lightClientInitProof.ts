import {deserializeProof, Proof, serializeProof} from "@chainsafe/persistent-merkle-tree";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Bucket, IDatabaseController, IDbMetrics, Repository} from "@chainsafe/lodestar-db";
import {Type} from "@chainsafe/ssz";

export class LightClientInitProofRepository extends Repository<Uint8Array, Proof> {
  constructor(config: IBeaconConfig, db: IDatabaseController<Buffer, Buffer>, metrics?: IDbMetrics) {
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

export class LightClientInitProofStateRootRepository extends Repository<number, Uint8Array> {
  constructor(config: IBeaconConfig, db: IDatabaseController<Buffer, Buffer>, metrics?: IDbMetrics) {
    super(config, db, Bucket.altair_lightClientInitProofStateRoot, (undefined as unknown) as Type<Uint8Array>, metrics);
  }

  encodeValue(value: Uint8Array): Buffer {
    return Buffer.from(value);
  }

  decodeValue(data: Uint8Array): Uint8Array {
    return data;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  getId(value: Uint8Array): number {
    throw new Error("Cannot get the db key from a state root");
  }
}
