import {describe, expect, it} from "vitest";
import {DOMAIN_APPLICATION_BUILDER, DOMAIN_APPLICATION_MASK} from "../../src/index.js";

describe("validate application domains", () => {
  [{name: "builder domain", domain: DOMAIN_APPLICATION_BUILDER}].map(({name, domain}) => {
    it(name, () => {
      let r = 0;
      for (let i = 0; i < DOMAIN_APPLICATION_MASK.length; i++) {
        r += DOMAIN_APPLICATION_MASK[i] & domain[i];
      }

      expect(r > 0).toBeWithMessage(true, `${name} mask application should be valid`);
    });
  });
});
