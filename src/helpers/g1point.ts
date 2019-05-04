import {BIG, ECP} from "../../amcl/version3/js/ctx";
import ctx from "../ctx";
import {bytes48} from "../types";

export class G1point {

  private point: ECP;

  public constructor(point: ECP) {
    this.point = point;
  }

  public mul(value: BIG): G1point {
    const newPoint = this.point.mul(value);
    return new G1point(newPoint);
  }

  public toBytes(): bytes48 {
    const buffer = Buffer.alloc(48);
    this.point.getX().toBytes(buffer, true);
    return buffer;
  }


  public static generator(): G1point {
    return new G1point(ctx.ECP.generator());
  }
}
