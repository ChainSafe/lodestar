import {BitVector} from "@chainsafe/ssz";
import {ENR} from "@chainsafe/discv5";
import {Metadata} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

export interface IMetadataOpts {
  enr?: ENR;
  metadata?: Metadata;
}

export interface IMetadataModules {
  config: IBeaconConfig;
}

export class MetadataController {
  public enr?: ENR;

  private config: IBeaconConfig;
  private _metadata: Metadata;

  constructor(opts: IMetadataOpts, modules: IMetadataModules) {
    this.enr = opts.enr;
    this.config = modules.config;
    this._metadata = opts.metadata || this.config.types.Metadata.defaultValue();
    if (this.enr) {
      this.enr.set("attnets", Buffer.from(this.config.types.AttestationSubnets.serialize(this._metadata.attnets)));
    }
  }

  get seqNumber(): bigint {
    return this._metadata.seqNumber;
  }

  get attnets(): BitVector {
    return this._metadata.attnets;
  }

  set attnets(attnets: BitVector) {
    if (this.enr) {
      this.enr.set("attnets", Buffer.from(this.config.types.AttestationSubnets.serialize(attnets)));
    }
    this._metadata.seqNumber++;
    this._metadata.attnets = attnets;
  }

  get metadata(): Metadata {
    return this._metadata;
  }
}
