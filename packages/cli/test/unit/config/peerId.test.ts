import {describe, it, expect} from "vitest";
import {generateKeyPair} from "@libp2p/crypto/keys";
import {getTestdirPath} from "../../utils.js";
import {writePrivateKey, readPrivateKey} from "../../../src/config/index.js";

describe("config / peerId", () => {
  const peerIdFilepath = getTestdirPath("./test-peer-id.json");

  it("create, write and read PeerId", async () => {
    const privateKey = await generateKeyPair("secp256k1");
    writePrivateKey(peerIdFilepath, privateKey);
    const pkRead = readPrivateKey(peerIdFilepath);

    expect(pkRead.toString()).toBe(privateKey.toString());
  });
});
