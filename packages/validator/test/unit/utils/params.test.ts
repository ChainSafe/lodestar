import {createIChainConfig} from "@chainsafe/lodestar-config";
import {chainConfig} from "@chainsafe/lodestar-config/default";
import {expect} from "chai";
import {assertEqualParams, NotEqualParamsError} from "../../../src/util/params";

describe("utils / params / assertEqualParams", () => {
  it("default == default", () => {
    assertEqualParams(chainConfig, chainConfig);
  });
  it("default != other", () => {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    const otherConfig = createIChainConfig({...chainConfig, ALTAIR_FORK_EPOCH: 0});
    expect(() => assertEqualParams(chainConfig, otherConfig)).to.throw(NotEqualParamsError);
  });
});
