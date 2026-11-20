import {describe, expect, it} from "vitest";
import {parseGossipIdentities} from "../../../../src/cmds/builder/gossipIdentities.js";

describe("gossip identity configuration file", () => {
  const valid = {keystore: "builder-1.json", keystorePassword: "password.txt", deadlineBps: 9750};
  it("accepts a bounded list of keystore paths and exact deadlines", () => {
    expect(parseGossipIdentities([valid])).toEqual([valid]);
    expect(parseGossipIdentities([])).toEqual([]);
  });
  it.each([
    null,
    {},
    "bad",
    [null],
    [1],
    [{...valid, keystore: ""}],
    [{...valid, keystorePassword: 1}],
    [{...valid, deadlineBps: 9750.5}],
    [{...valid, builderPubkey: 1}],
    Array(5).fill(valid),
  ])("rejects malformed config without echoing its contents %j", (value) => {
    expect(() => parseGossipIdentities(value)).toThrow();
  });
});
