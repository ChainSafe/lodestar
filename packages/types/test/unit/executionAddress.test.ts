import {describe, it, expect} from "vitest";
import {toChecksumAddress} from "../../src/utils/executionAddress.js";

describe("toChecksumAddress", () => {
  it("should fail with invalid addresses", () => {
    expect(() => toChecksumAddress("1234")).toThrowError("Invalid address: 1234");
    expect(() => toChecksumAddress("0x1234")).toThrowError("Invalid address: 0x1234");
  });

  it("should format addresses as ERC55", () => {
    type TestCase = {
      address: string;
      checksumAddress: string;
    };

    const testCases: TestCase[] = [
      // Input all caps
      {
        address: "0x52908400098527886E0F7030069857D2E4169EE7",
        checksumAddress: "0x52908400098527886E0F7030069857D2E4169EE7",
      },
      {
        address: "0xDE709F2102306220921060314715629080E2FB77",
        checksumAddress: "0xde709f2102306220921060314715629080e2fb77",
      },
      // Without 0x prefix
      {
        address: "52908400098527886e0f7030069857d2e4169ee7",
        checksumAddress: "0x52908400098527886E0F7030069857D2E4169EE7",
      },
      // All caps
      {
        address: "0x52908400098527886e0f7030069857d2e4169ee7",
        checksumAddress: "0x52908400098527886E0F7030069857D2E4169EE7",
      },
      {
        address: "0x8617e340b3d01fa5f11f306f4090fd50e238070d",
        checksumAddress: "0x8617E340B3D01FA5F11F306F4090FD50E238070D",
      },
      // All lower
      {
        address: "0xde709f2102306220921060314715629080e2fb77",
        checksumAddress: "0xde709f2102306220921060314715629080e2fb77",
      },
      {
        address: "0x27b1fdb04752bbc536007a920d24acb045561c26",
        checksumAddress: "0x27b1fdb04752bbc536007a920d24acb045561c26",
      },
      // Normal
      {
        address: "0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed",
        checksumAddress: "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
      },
      {
        address: "0xfb6916095ca1df60bb79ce92ce3ea74c37c5d359",
        checksumAddress: "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359",
      },
      {
        address: "0xdbf03b407c01e7cd3cbea99509d93f8dddc8c6fb",
        checksumAddress: "0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB",
      },
      {
        address: "0xd1220a0cf47c7b9be7a2e6ba89f429762e7b9adb",
        checksumAddress: "0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb",
      },
    ];

    for (const {address, checksumAddress} of testCases) {
      expect(toChecksumAddress(address)).toBe(checksumAddress);
    }
  });
});
