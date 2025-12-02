import {describe, expect, it} from "vitest";
import {peerIdFromString, peerIdToString} from "../../../src/util/peerId.js";

describe("network peerid", () => {
  it("PeerId serdes", async () => {
    const peerIdStr = "16Uiu2HAkumpXRXoTBqw95zvfqiSVb9WfHUojnsa5DTDHz1cWRoDn";
    const peerId = peerIdFromString(peerIdStr);
    expect(peerIdToString(peerId)).toBe(peerIdStr);
  });
});
