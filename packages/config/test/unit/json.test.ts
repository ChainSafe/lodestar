import {expect} from "chai";
import {chainConfigFromJson, chainConfigToJson} from "../../src";
import {chainConfig} from "../../src/default";

describe("chainConfig JSON", () => {
  it("Convert to and from JSON", () => {
    const json = chainConfigToJson(chainConfig);
    const chainConfigRes = chainConfigFromJson(json);

    expect(chainConfigRes).to.deep.equal(chainConfig);
  });
});
