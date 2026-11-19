import {describe, expect, it} from "vitest";
import {fromHex, toHex} from "@lodestar/utils";
import {XmssSigner} from "../../../src/services/xmssSigner.js";

describe("XmssSigner", () => {
  // The vector of the Lighthouse and ethPandaOps genesis tooling
  it("derives a keystore's leanXMSS key and VRF root as the devnet genesis does", async () => {
    const signer = await XmssSigner.fromBlsSecretKey(
      fromHex("0x2892f3ba475c3640a67fe730798ad9c4eed3a6d934db85f91c41cfc837ce8834")
    );
    expect(toHex(signer.publicKey)).toBe("0x155a29b971da2b771fdf52c768af63fa03f78f25487e3e0ed03d012b7039d88b");
    expect(toHex(signer.vrfRoot)).toBe("0x46f6772a35c14c7f8467e9d8791450ed3c6853191129876fc50e769ec9bac18d");
  }, 60_000);
});
