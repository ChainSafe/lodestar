import {describe, it, expect} from "vitest";
import {chainConfigFromJson, chainConfigToJson} from "../../src/index.js";
import {chainConfig} from "../../src/default.js";

describe("chainConfig JSON", () => {
  it("Convert to and from JSON", () => {
    const json = chainConfigToJson(chainConfig);
    const chainConfigRes = chainConfigFromJson(json);

    expect(chainConfigRes).toEqual(chainConfig);
  });
});
