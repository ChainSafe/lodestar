import {BIG} from "@chainsafe/milagro-crypto-js/src/big";
import {ECP2} from "@chainsafe/milagro-crypto-js/src/ecp2";
import { sha256 } from 'js-sha256';
import ctx from "../ctx";
import * as random from "secure-random";
import {calculateYFlag, getModulus, padLeft} from "./utils";
import assert from "assert";
import {FP_POINT_LENGTH, G2_HASH_PADDING} from "../constants";
import {bytes32, bytes48, Domain} from "@chainsafe/eth2.0-types";

export class G2point {

  private point: ECP2;

  public constructor(point: ECP2) {
    this.point = point;
  }

  public add(other: G2point): G2point {
    const sum = new ctx.ECP2();
    sum.add(this.point);
    sum.add(other.point);
    sum.affine();
    return new G2point(sum);
  }

  public mul(value: BIG): G2point {
    const newPoint = this.point.mul(value);
    return new G2point(newPoint);
  }

  public equal(other: G2point): boolean {
    return this.point.equals(other.point);
  }

  public getPoint(): ECP2 {
    return this.point;
  }

  public toBytesCompressed(): bytes48 {
    const xReBytes = Buffer.alloc(FP_POINT_LENGTH, 0);
    const xImBytes = Buffer.alloc(FP_POINT_LENGTH, 0);
    this.point.getX().getA().tobytearray(xReBytes, 0);
    this.point.getX().getB().tobytearray(xImBytes, 0);
    const c1 = true;
    const b1 = this.point.is_infinity();
    const a1 = !b1 && calculateYFlag(this.point.getY().getB());

    const flags = ((a1 ? 1 << 5 : 0) | (b1 ? 1 << 6 : 0) | (c1 ? 1 << 7 : 0));
    const mask = 31;
    xImBytes[0] &= mask;
    xImBytes[0] |= flags;
    xReBytes[0] &= mask;

    return Buffer.concat([
      xImBytes,
      xReBytes
    ]);
  }

  public static hashToG2(message: bytes32, domain: Domain): G2point {
    const padding = Buffer.alloc(G2_HASH_PADDING, 0);
    const xReBytes = Buffer.concat([
      padding,
      Buffer.from(sha256.arrayBuffer(
        Buffer.concat([
          message,
          padLeft(domain, 8),
          Buffer.from('01', 'hex')
        ])
      ))
    ]);
    const xImBytes = Buffer.concat([
      padding,
      Buffer.from(sha256.arrayBuffer(
        Buffer.concat([
          message,
          padLeft(domain, 8),
          Buffer.from('02', 'hex')
        ])
      ))
    ]);
    const xRe = ctx.BIG.frombytearray(xReBytes, 0);
    const xIm = ctx.BIG.frombytearray(xImBytes, 0);
    const one = new ctx.BIG(1);
    let point = new ctx.ECP2();
    point.setx(new ctx.FP2(xRe, xIm));
    while (point.is_infinity()) {
      xRe.add(one);
      xRe.norm();
      point = new ctx.ECP2();
      point.setx(new ctx.FP2(xRe, xIm));
    }
    return new G2point(G2point.scaleWithCofactor(G2point.normaliseY(point)));
  }

  public static fromCompressedBytes(value: bytes48): G2point {
    assert(value.length === 2 * FP_POINT_LENGTH, 'Expected signature of 96 bytes');
    value = Buffer.from(value);
    const xImBytes = value.slice(0, FP_POINT_LENGTH);
    const xReBytes = value.slice(FP_POINT_LENGTH);
    const aIn = (xImBytes[0] & (1 << 5)) != 0;
    const bIn = (xImBytes[0] & (1 << 6)) != 0;
    const cIn = (xImBytes[0] & (1 << 7)) != 0;
    //clear bits
    xImBytes[0] &= 31;
    if((xReBytes[0] & 224) != 0) {
      throw new Error("The input has non-zero a2, b2 or c2 flag on xRe");
    }
    if(!cIn) {
      throw new Error("The serialised input does not have the C flag set.");
    }
    const xIm = ctx.BIG.frombytearray(xImBytes, 0);
    const xRe = ctx.BIG.frombytearray(xReBytes, 0);
    if (bIn) {
      if (!aIn
                && xIm.iszilch()
                && xRe.iszilch() ) {
        // This is a correctly formed serialisation of infinity
        return new G2point(new ctx.ECP2());
      } else {
        // The input is malformed
        throw new Error(
          "The serialised input has B flag set, but A flag is set, or X is non-zero.");
      }
    }

    const modulus = getModulus();
    if(ctx.BIG.comp(modulus, xRe) <= 0 || ctx.BIG.comp(modulus, xIm) <= 0) {
      throw new Error(
        "The deserialised X real or imaginary coordinate is too large.");
    }

    let point = new ctx.ECP2();
    point.setx(new ctx.FP2(xRe, xIm));
    if(point.is_infinity()) {
      throw new Error("X coordinate is not on the curve.");
    }

    if (!point.is_infinity() && aIn != calculateYFlag(point.getY().getB())) {
      // We didn't: so choose the other branch of the sqrt.
      const x = point.getX();
      const yneg = point.getY();
      yneg.neg();
      point.setxy(x, yneg);
    }

    return new G2point(point);
  }

  public static fromUncompressedInput(
    xReBytes: Buffer,
    xImBytes: Buffer,
    yReBytes: Buffer,
    yImBytes: Buffer,
    zReBytes: Buffer,
    zImBytes: Buffer): G2point {
    const xRe = ctx.BIG.frombytearray(padLeft(xReBytes, FP_POINT_LENGTH), 0);
    const xIm = ctx.BIG.frombytearray(padLeft(xImBytes, FP_POINT_LENGTH), 0);
    const yRe = ctx.BIG.frombytearray(padLeft(yReBytes, FP_POINT_LENGTH), 0);
    const yIm = ctx.BIG.frombytearray(padLeft(yImBytes, FP_POINT_LENGTH), 0);
    const zRe = ctx.BIG.frombytearray(padLeft(zReBytes, FP_POINT_LENGTH), 0);
    const zIm = ctx.BIG.frombytearray(padLeft(zImBytes, FP_POINT_LENGTH), 0);
    const x = new ctx.FP2(xRe, xIm);
    const y = new ctx.FP2(yRe, yIm);
    const z = new ctx.FP2(zRe, zIm);
    z.inverse();
    x.mul(z);
    x.reduce();
    y.mul(z);
    y.reduce();
    const point = new ctx.ECP2();
    point.setxy(x, y);
    return new G2point(point);
  }

  public static random(): G2point {
    let point: ECP2;
    do {
      point = new ctx.ECP2();
      point.setx(
        new ctx.FP2(
          ctx.BIG.frombytearray(
            random.randomBuffer(FP_POINT_LENGTH),
            0
          ),
          ctx.BIG.frombytearray(
            random.randomBuffer(FP_POINT_LENGTH),
            0
          )
        )
      );
    } while (point.is_infinity());
    return new G2point(point);
  }

  public static scaleWithCofactor(point: ECP2): ECP2 {
    const upper = ctx.BIG.frombytearray(
      Buffer.from(
        "0000000000000000000000000000000005d543a95414e7f1091d50792876a202cd91de4547085abaa68a205b2e5a7ddf",
        "hex"
      ),
      0
    );
    const lower = ctx.BIG.frombytearray(
      Buffer.from(
        "00000000000000000000000000000000a628f1cb4d9e82ef21537e293a6691ae1616ec6e786f0c70cf1c38e31c7238e5",
        "hex"
      ),
      0
    );
    const shift = ctx.BIG.frombytearray(
      Buffer.from(
        "000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000000",
        "hex"
      ),
      0
    );
    let sum = new ctx.ECP2();
    sum.copy(point);
    sum = sum.mul(upper);
    sum = sum.mul(shift);

    let tmp = new ctx.ECP2();
    tmp.copy(point);
    tmp = tmp.mul(lower);

    sum.add(tmp);

    return sum;
  }

  public static normaliseY(point: ECP2): ECP2 {
    const y = point.getY();
    const yNeg = new ctx.FP2(y);
    yNeg.neg();
    if (ctx.BIG.comp(y.getB(), yNeg.getB()) < 0
            || ((ctx.BIG.comp(y.getB(), yNeg.getB()) == 0)
                && ctx.BIG.comp(y.getA(), yNeg.getA()) < 0)
    ) {
      const newPoint = new ctx.ECP2();
      newPoint.setxy(point.getX(), yNeg);
      return newPoint;
    } else {
      return point;
    }
  }
}
