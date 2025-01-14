import {createSecp256k1PeerId} from "@libp2p/peer-id-factory";
import {describe, expect, it} from "vitest";
import {readPeerId, writePeerId} from "../../../src/config/index.js";
import {getTestdirPath} from "../../utils.js";

describe("config / peerId", () => {
  const peerIdFilepath = getTestdirPath("./test-peer-id.json");

  it("create, write and read PeerId", async () => {
    const peerId = await createSecp256k1PeerId();
    writePeerId(peerIdFilepath, peerId);
    const peerIdRead = await readPeerId(peerIdFilepath);

    expect(peerIdRead.toString()).toBe(peerId.toString());
  });
});
