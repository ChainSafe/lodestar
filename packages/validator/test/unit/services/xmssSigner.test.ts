import {describe, expect, it} from "vitest";
import {fromHex, toHex} from "@lodestar/utils";
import {XmssSigner, XmssTreeStore, getXmssPublicParameter, hasXmssTrees} from "../../../src/services/xmssSigner.js";

describe("XmssSigner", () => {
  // Validator 0 of the default ethereum-package mnemonic at the pq-devnet-1 genesis: its leanXMSS
  // key and VRF root from the `.bin` file of ethPandaOps (sha256 109b3669...), and its record from
  // the `.vrf` file (sha256 9bf10368...)
  it("derives a keystore's leanXMSS key and VRF root as the devnet genesis does", async () => {
    const vrfRoot = "0x75d1866ec07565ce2f2e3d0e368fe0193f868f326f5c469698c4a6e1e70575a7";
    const vrfStates = fromHex(
      [
        vrfRoot,
        "00000000",
        "60961f9391410c89b136d976b68d1c6818c1fce2f5189e2d7dbad4b4b31b73d2",
        "2ac052c66618d2ca42ebfc6ad75444fea145568f2122db1d8ffb0a4a695410ed",
        "166656b737c86c06c36c9c55eb6b33553906aaad921f4febf8531f4fe7f98220",
        "652712965eb130d84e4e4a08487f6d5a499ed354ba18db632ffc6ba3373508d3",
        "a057559422d634ecd1f3ea3b2e034e79e73db6bf2fb4f82e1076a87b958bc054",
        "92e9f590536597edb0cfdb1638f928e68f652fd152c93a2fec73641dd7ade527",
        "fcd582dc7e6b9bc9ed3158df565b883645c40848e9ae84642429991fa03e92e7",
        "6f70e5521c89b8832e6f8b2018415446b489692218c1518fee68cfa763ed5fbf",
        "315bc4f7592ae23a219f156a42affeb7d786c87fbd2f31351923c7d4e043c1ea",
        "f1ec67f4445dbf61911cbab41558da9663d234d9f77cf20884a2fe3c089f58dc",
        "eb52bb222dfdfe96d809739c5f7d9716fbd9e065f17d4bc8c1346483a9baff3b",
        "acb9bb28173c7d090417f773e71459d644ef951b7f47d0f8e0a68efeca23a7d9",
        "98744397ee0c4581d7ac58717851eb009dc58e234c36f23d175785b5c3b9dc0c",
        "0a3ab28aecc71296499a7447957a1dbf36de680aeff05eaf917ac77594ae109f",
        "e6fe08270185e89fe39b08a22354b16021a43086a458ab0df023813e261ccc70",
        "93a1124d53b41d355daf763be641f6f2785f549a1e9bda822785288550ea462d",
        "c23daebc0593b48de80a5460356edb3fb18e13ed68a2047dd7b125775e316e41",
        "706b330d1cbb4b538af0677b7559bac7cfeb4500dfa3eec0092d162e6b420828",
        "7bfa822fd12d715cc63754b628b6c9f8009f02269aa8802a9706968ef67bd679",
        "81d5da9733aacff486fbb6496d80df721beb2bbab8865461c197c685c62cbde3",
        "46386632eaeef21168ec0c5d9903a2230e4dcf65937d206cd4af34ba09bc2c34",
        "aa9f0181ab56e376883f2b54cb9b9b936fef369063574da4db74a7777fd9cbf9",
        "3276c74b9dcbe2e137b58e96ee127c6fb2853b2f644394e2944e2347c6cf4c69",
        "ab1b1ecada4971322ee6099d8ea9030b0e38b5a6b1e6f0027ac0ecd98a8cbdba",
        "446d941faa412f0418b74cbdd05504164231b55a0b67ca604c9240e6a69c3894",
        "bcc260fc1c13b8894e9174a5d6e694df79fbda97d0b62ac880b92353de0edb95",
        "1b8e0a58439148e95ad661d98b259ae6a4d82e72f25e58354b8bc43e4745021c",
        "8fb4faa40822d3e4b449322eed3c51c3ae855f6ed915b0b8429a061fc755ce37",
        "12601a539f32b1e0c338b4db274a153526a7fb5c679f9ba6b4335bb692c9e49d",
        "5a56b174ccd3cdc9249196c31edc4ca29266434a5c7d965ae62bea4db9c61f24",
        "502b4f387e8f70dff47cc45d63b467a15588d541198698288299be769c02d0ad",
      ].join("")
    );
    const signer = await XmssSigner.fromBlsSecretKey(
      fromHex("0x0dce41fa73ae9f6bdfd51df4d422d75eee174553dba5fd450c4437e4ed3fc903"),
      {vrfStates}
    );
    expect(toHex(signer.publicKey)).toBe("0xd7792e263b94cf0b7a9f70d8374c6d34a600b4247057d4079f810caff711c632");
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
