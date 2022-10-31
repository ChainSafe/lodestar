import sinon, {SinonMatcher} from "sinon";
import {toHexString} from "@chainsafe/ssz";

export const bufferEqualsMatcher = (expected: Buffer): SinonMatcher => {
  return sinon.match((value) => {
    return toHexString(expected) === toHexString(value);
  });
};
