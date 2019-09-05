import {BIG} from "@chainsafe/milagro-crypto-js/src/big";
import {ECP} from "@chainsafe/milagro-crypto-js/src/ecp";
import ctx from "../ctx";
import assert from "assert";
import {calculateYFlag, getModulus} from "./utils";
import * as random from "secure-random";
import {FP_POINT_LENGTH} from "../constants";
import {BLSPubkey, bytes48} from "@chainsafe/eth2.0-types";

export class G1point {

  private point: ECP;

  public constructor(point: ECP) {
    this.point = point;
  }

  public mul(value: BIG): G1point {
    const newPoint = this.point.mul(value);
    return new G1point(newPoint);
  }

  public add(other: G1point): G1point {
    const sum = new ctx.ECP();
    sum.add(this.point);
    sum.add(other.point);
    sum.affine();
    return new G1point(sum);
  }

  public addRaw(other: bytes48): G1point {
    return this.add(G1point.fromBytesCompressed(other));
  }

  public equal(other: G1point): boolean {
    return this.point.equals(other.point);
  }

  public toBytes(): bytes48 {
    const buffer = Buffer.alloc(FP_POINT_LENGTH, 0);
    this.point.getX().tobytearray(buffer, 0);
    return buffer;
  }

  public getPoint(): ECP {
    return this.point;
  }

  public toBytesCompressed(): bytes48 {
    const output = this.toBytes();
    const c = true;
    const b = this.point.is_infinity();
    const a = !b && calculateYFlag(this.point.getY());

    const flags = ((a ? 1 << 5 : 0) | (b ? 1 << 6 : 0) | (c ? 1 << 7 : 0));
    const mask =  31;
    output[0] &= mask;
    output[0] |= flags;
    return output;
  }

  public static fromBytesCompressed(value: bytes48): G1point {
    assert(value.length === FP_POINT_LENGTH, `Expected g1 compressed input to have ${FP_POINT_LENGTH} bytes`);
    value = Buffer.from(value);
    const aIn = (value[0] & (1 << 5)) != 0;
    const bIn = (value[0] & (1 << 6)) != 0;
    const cIn = (value[0] & (1 << 7)) != 0;
    value[0] &=  31;

    if (!cIn) {
      throw new Error("The serialised input does not have the C flag set.");
    }

    const x = ctx.BIG.frombytearray(value, 0);
    if (bIn) {
      if (!aIn && x.iszilch()) {
        // This is a correctly formed serialisation of infinity
        return new G1point(new ctx.ECP());
      } else {
        // The input is malformed
        throw new Error(
          "The serialised input has B flag set, but A flag is set, or X is non-zero.");
      }
    }
    const modulus = getModulus();
    if (ctx.BIG.comp(modulus, x) <= 0) {
      throw new Error("X coordinate is too large.");
    }

    let point = new ctx.ECP();
    point.setx(x);

    if (point.is_infinity()) {
      throw new Error("X coordinate is not on the curve.");
    }

    // Did we get the right branch of the sqrt?
    if (!point.is_infinity() && aIn != calculateYFlag(point.getY())) {
      // We didn't: so choose the other branch of the sqrt.
      const x = new ctx.FP(point.getX());
      const yneg = new ctx.FP(point.getY());
      yneg.neg();
      point.setxy(x.redc(), yneg.redc());
    }

    return new G1point(point);
  }

  public static aggregate(values: bytes48[]): G1point {
    return values.map((value) => {
      return G1point.fromBytesCompressed(value);
    }).reduce((previousValue, currentValue): G1point => {
      return previousValue.add(currentValue);
    });
  }

  public static generator(): G1point {
    return new G1point(ctx.ECP.generator());
  }

  public static random(): G1point {
    let ecp: ECP;
    do {
      ecp = new ctx.ECP();
      ecp.setx(
        ctx.BIG.frombytearray(
          random.randomBuffer(FP_POINT_LENGTH),
          0
        )
      );
    } while (ecp.is_infinity());
    return new G1point(ecp);
  }
}
