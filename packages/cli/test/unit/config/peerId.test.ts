import {generateKeyPair} from "@libp2p/crypto/keys";
import {describe, expect, it} from "vitest";
import {readPrivateKey, writePrivateKey} from "../../../src/config/index.js";
import {getTestdirPath} from "../../utils.js";

describe("config / peerId", () => {
  const peerIdFilepath = getTestdirPath("./test-peer-id.json");

  it("create, write and read PeerId", async () => {
    const privateKey = await generateKeyPair("secp256k1");
    writePrivateKey(peerIdFilepath, privateKey);
    const pkRead = readPrivateKey(peerIdFilepath);

    expect(pkRead.toString()).toBe(privateKey.toString());
  });
});
