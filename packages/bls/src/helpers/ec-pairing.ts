import {G1point} from "./g1point";
import {G2point} from "./g2point";
import {FP12} from "@chainsafe/milagro-crypto-js/src/fp12";
import ctx from "../ctx";


export class ElipticCurvePairing {

  public static pair(p1: G1point, p2: G2point): FP12 {
    const e = ctx.PAIR.ate(p2.getPoint(), p1.getPoint());
    return ctx.PAIR.fexp(e);
  }

}
