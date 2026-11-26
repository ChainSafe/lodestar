import {describe, expect, it} from "vitest";
import {fromHex, toHex} from "@lodestar/utils";
import {XmssSigner, XmssTreeStore, getXmssPublicParameter, hasXmssTrees} from "../../../src/services/xmssSigner.js";

describe("XmssSigner", () => {
  // The vector of the Lighthouse and ethPandaOps genesis tooling
  it("derives a keystore's leanXMSS key and VRF root as the devnet genesis does", async () => {
    const signer = await XmssSigner.fromBlsSecretKey(
      fromHex("0x2892f3ba475c3640a67fe730798ad9c4eed3a6d934db85f91c41cfc837ce8834")
    );
    expect(toHex(signer.publicKey)).toBe("0x155a29b971da2b771fdf52c768af63fa03f78f25487e3e0ed03d012b7039d88b");
    const vrfRoot = "0x46f6772a35c14c7f8467e9d8791450ed3c6853191129876fc50e769ec9bac18d";
    expect(toHex(await signer.getVrfRoot())).toBe(vrfRoot);

    // A tree the state holds another root for is not the validator's: it opens no slot
    signer.setRegisteredVrfRoot(fromHex(vrfRoot));
    expect(await signer.vrfProof(3)).toHaveLength(1024);
    signer.setRegisteredVrfRoot(new Uint8Array(32));
    await expect(signer.vrfProof(3)).rejects.toThrow("is not the validator's in the state");
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

    expect(hasXmssTrees(secretKey, store)).toBe(true);
    expect(hasXmssTrees(new Uint8Array(32).fill(3), store)).toBe(false);
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

  it("stores a VRF tree's subtree roots and loads the tree from them in place of building it", async () => {
    const memoryStore = (): XmssTreeStore & {stored: Uint8Array | null; writes: number} => ({
      stored: null,
      writes: 0,
      read() {
        return this.stored;
      },
      write(bytes) {
        this.stored = bytes;
        this.writes++;
      },
    });
    const secretKey = new Uint8Array(32).fill(1);
    const treeStore = memoryStore();
    const vrfTreeStore = memoryStore();

    const built = await XmssSigner.fromBlsSecretKey(secretKey, {treeStore, vrfTreeStore});
    expect(built.vrfTreeSource).toBe(null);
    const vrfRoot = await built.getVrfRoot();
    expect(built.vrfTreeSource).toBe("built");
    expect(vrfTreeStore.writes).toBe(1);
    // The populated depth, 16 subtree roots, the MAC
    expect(vrfTreeStore.stored).toHaveLength(1 + 16 * 32 + 32);

    const loaded = await XmssSigner.fromBlsSecretKey(secretKey, {treeStore, vrfTreeStore});
    expect(await loaded.getVrfRoot()).toEqual(vrfRoot);
    expect(loaded.vrfTreeSource).toBe("stored");
    expect(await loaded.vrfProof(70_000)).toEqual(await built.vrfProof(70_000));
    expect(vrfTreeStore.writes).toBe(1);

    // Roots that are altered, or that another key stored, are not loaded: the tree is built and stored again
    const sealed = vrfTreeStore.stored as Uint8Array;
    for (const offset of [0, 1, sealed.length - 1]) {
      const altered = memoryStore();
      altered.stored = Uint8Array.from(sealed);
      altered.stored[offset] ^= 1;
      const rebuilt = await XmssSigner.fromBlsSecretKey(secretKey, {treeStore, vrfTreeStore: altered});
      expect(await rebuilt.getVrfRoot(), `wrong root with byte ${offset} altered`).toEqual(vrfRoot);
      expect(rebuilt.vrfTreeSource, `tree loaded with byte ${offset} altered`).toBe("built");
      expect(altered.stored, `store not rewritten with byte ${offset} altered`).toEqual(sealed);
    }

    // A store that throws costs the build and no more
    const throwing = (method: "read" | "write"): XmssTreeStore => ({
      read: () => {
        if (method === "read") throw Error("read failed");
        return null;
      },
      write: () => {
        if (method === "write") throw Error("write failed");
      },
    });
    for (const method of ["read", "write"] as const) {
      const signer = await XmssSigner.fromBlsSecretKey(secretKey, {treeStore, vrfTreeStore: throwing(method)});
      expect(await signer.getVrfRoot(), `wrong root when ${method} throws`).toEqual(vrfRoot);
      expect(signer.vrfTreeSource, `wrong source when ${method} throws`).toBe("built");
      expect(await signer.vrfProof(70_000), `wrong proof when ${method} throws`).toEqual(await built.vrfProof(70_000));
    }
    const other = await XmssSigner.fromBlsSecretKey(new Uint8Array(32).fill(3), {vrfTreeStore});
    expect(await other.getVrfRoot()).not.toEqual(vrfRoot);
    expect(other.vrfTreeSource).toBe("built");
    expect(vrfTreeStore.writes).toBe(2);
  }, 120_000);
});
