import {describe, expect, it} from "vitest";
import {chainConfig} from "../../src/default.js";
import {chainConfigFromJson, chainConfigToJson} from "../../src/index.js";

describe("chainConfig JSON", () => {
  it("Convert to and from JSON", () => {
    const json = chainConfigToJson(chainConfig);
    const chainConfigRes = chainConfigFromJson(json);

    expect(chainConfigRes).toEqual(chainConfig);
  });
});
