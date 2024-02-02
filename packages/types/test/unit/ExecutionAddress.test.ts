import {describe, it, expect} from "vitest";
import {toChecksumAddress} from "../../src/utils/ExecutionAddress.js";

describe("toChecksumAddress", () => {
  it("should fail with invalid addresses", () => {
    expect(() => toChecksumAddress("0x1234")).toThrowError("Invalid address");
  });

  it("should format address as ERC55", () => {
    type TestCase = {
      address: string;
      checksumedAddress: string;
    };

    expect(toChecksumAddress("52908400098527886E0F7030069857D2E4169EE7")).toBe(
      "0x52908400098527886E0F7030069857D2E4169EE7"
    );

    const testCases: TestCase[] = [
      // All caps
      {
        address: "0x52908400098527886E0F7030069857D2E4169EE7",
        checksumedAddress: "0x52908400098527886E0F7030069857D2E4169EE7",
      },
      {
        address: "0x8617E340B3D01FA5F11F306F4090FD50E238070D",
        checksumedAddress: "0x8617E340B3D01FA5F11F306F4090FD50E238070D",
      },
      // All lower
      {
        address: "0xde709f2102306220921060314715629080e2fb77",
        checksumedAddress: "0xdE709F2102306220921060314715629080e2fB77",
      },
      {
        address: "0x27b1fdb04752bbc536007a920d24acb045561c26",
        checksumedAddress: "0x27B1FDb04752BBC536007A920d24acB045561C26",
      },
      // Normal
      {
        address: "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
        checksumedAddress: "0x5AAEB6053F3E94C9b9A09F33669435E7Ef1BeAED",
      },
      {
        address: "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359",
        checksumedAddress: "0xFB6916095ca1dF60BB79Ce92cE3Ea74C37C5D359",
      },
      {
        address: "0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB",
        checksumedAddress: "0xdBF03B407c01E7CD3CBEA99509d93F8DDDC8C6FB",
      },
      {
        address: "0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb",
        checksumedAddress: "0xD1220A0cf47C7B9BE7A2E6BA89F429762e7B9ADB",
      },
    ];

    for (const {address, checksumedAddress} of testCases) {
      expect(toChecksumAddress(address)).toBe(checksumedAddress);
    }
  });
});
