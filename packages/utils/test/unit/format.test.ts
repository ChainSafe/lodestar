import {describe, it, expect} from "vitest";
import {toChecksumAddress} from "../../src/index.js";

describe("toChecksumAddress", () => {
  it("should format address as ERC55", () => {
    expect(toChecksumAddress("52908400098527886E0F7030069857D2E4169EE7")).toBe(
      "0x52908400098527886E0F7030069857D2E4169EE7"
    );
    expect(toChecksumAddress("0x52908400098527886E0F7030069857D2E4169EE7")).toBe(
      "0x52908400098527886E0F7030069857D2E4169EE7"
    );
    expect(toChecksumAddress("0xde709f2102306220921060314715629080e2fb77")).toBe(
      "0xdE709F2102306220921060314715629080e2fB77"
    );
    expect(toChecksumAddress("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed")).toBe(
      "0x5AAEB6053F3E94C9b9A09F33669435E7Ef1BeAED"
    );
  });
});
