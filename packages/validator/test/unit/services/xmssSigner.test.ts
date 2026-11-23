import {describe, expect, it} from "vitest";
import {fromHex, toHex} from "@lodestar/utils";
import {XmssSigner, XmssTreeStore, getXmssPublicParameter} from "../../../src/services/xmssSigner.js";

describe("XmssSigner", () => {
  // The vector of the Lighthouse and ethPandaOps genesis tooling
  it("derives a keystore's leanXMSS key and VRF root as the devnet genesis does", async () => {
    const signer = await XmssSigner.fromBlsSecretKey(
      fromHex("0x2892f3ba475c3640a67fe730798ad9c4eed3a6d934db85f91c41cfc837ce8834")
    );
    expect(toHex(signer.publicKey)).toBe("0x155a29b971da2b771fdf52c768af63fa03f78f25487e3e0ed03d012b7039d88b");
    expect(toHex(signer.vrfRoot)).toBe("0x46f6772a35c14c7f8467e9d8791450ed3c6853191129876fc50e769ec9bac18d");
  }, 60_000);

  it("stores a key's trees and loads them in place of building them", async () => {
    const secretKey = new Uint8Array(32).fill(1);
    const signingRoot = new Uint8Array(32).fill(2);
    let stored: Uint8Array | null = null;
    let writes = 0;
    const store: XmssTreeStore = {
      read: () => stored,
      write: (bytes) => {
        stored = bytes;
        writes++;
      },
    };

    const built = await XmssSigner.fromBlsSecretKey(secretKey, {treeStore: store});
    await built.prepare(0);
    await built.prepare(1);
    expect(writes).toBe(1);

    const loaded = await XmssSigner.fromBlsSecretKey(secretKey, {treeStore: store});
    expect(loaded.publicKey).toEqual(built.publicKey);
    expect(await loaded.sign(signingRoot, 7)).toEqual(await built.sign(signingRoot, 7));

    // What the store holds is not loaded unless this key wrote it
    const other = await XmssSigner.fromBlsSecretKey(new Uint8Array(32).fill(3), {treeStore: store});
    expect(other.publicKey).not.toEqual(built.publicKey);

    // Trees built elsewhere load against the public key that comes with them
    expect(getXmssPublicParameter(secretKey)).toEqual(built.publicKey.subarray(16));
    const trees = (stored as unknown as Uint8Array).subarray(32, -32);
    const given = await XmssSigner.fromBlsSecretKey(secretKey, {trees: {publicKey: built.publicKey, trees}});
    expect(await given.sign(signingRoot, 7)).toEqual(await built.sign(signingRoot, 7));
  }, 120_000);
});
