import {G2point} from "./helpers/g2point";
import assert from "assert";
import {FP_POINT_LENGTH} from "./constants";
import {BLSSignature} from "@chainsafe/eth2.0-types";

export class Signature {

  private point: G2point;

  public constructor(point: G2point) {
    this.point = point;
  }

  public add(other: Signature): Signature {
    return new Signature(
      this.point.add(other.point)
    );
  }

  public getPoint(): G2point {
    return this.point;
  }

  public toBytesCompressed(): BLSSignature {
    return this.point.toBytesCompressed();
  }

  public static fromCompressedBytes(signature: BLSSignature): Signature {
    assert(
      signature.length === 2 * FP_POINT_LENGTH,
      `Signature must have ${2 * FP_POINT_LENGTH} bytes`
    );
    return new Signature(G2point.fromCompressedBytes(signature));
  }
}
