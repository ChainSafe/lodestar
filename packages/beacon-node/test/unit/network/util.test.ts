import {describe, it, expect, afterEach} from "vitest";
import {config} from "@lodestar/config/default";
import {ForkName} from "@lodestar/params";
import {getDiscv5Multiaddrs} from "../../../src/network/libp2p/index.js";
import {getCurrentAndNextFork} from "../../../src/network/forks.js";

describe("getCurrentAndNextFork", () => {
  const altairEpoch = config.forks.altair.epoch;
  afterEach(() => {
    config.forks.altair.epoch = altairEpoch;
  });

  it("should return no next fork if altair epoch is infinity", () => {
    config.forks.altair.epoch = Infinity;
    const {currentFork, nextFork} = getCurrentAndNextFork(config, 0);
    expect(currentFork.name).toBe(ForkName.phase0);
    expect(nextFork).toBeUndefined();
  });

  it("should return altair as next fork", () => {
    config.forks.altair.epoch = 1000;
    let forks = getCurrentAndNextFork(config, 0);
    expect(forks.currentFork.name).toBe(ForkName.phase0);
    if (forks.nextFork) {
      expect(forks.nextFork.name).toBe(ForkName.altair);
    } else {
      expect.fail("No next fork");
    }

    forks = getCurrentAndNextFork(config, 1000);
    expect(forks.currentFork.name).toBe(ForkName.altair);
    expect(forks.nextFork).toBeUndefined();
  });
});

describe("getDiscv5Multiaddrs", () => {
  it("should extract bootMultiaddrs from enr with tcp", async () => {
    const enrWithTcp = [
      "enr:-LK4QDiPGwNomqUqNDaM3iHYvtdX7M5qngson6Qb2xGIg1LwC8-Nic0aQwO0rVbJt5xp32sRE3S1YqvVrWO7OgVNv0kBh2F0dG5ldHOIAAAAAAAAAACEZXRoMpA7CIeVAAAgCf__________gmlkgnY0gmlwhBKNA4qJc2VjcDI1NmsxoQKbBS4ROQ_sldJm5tMgi36qm5I5exKJFb4C8dDVS_otAoN0Y3CCIyiDdWRwgiMo",
    ];
    const bootMultiaddrs = await getDiscv5Multiaddrs(enrWithTcp);
    expect(bootMultiaddrs.length).toBe(1);
    expect(bootMultiaddrs[0]).toBe(
      "/ip4/18.141.3.138/tcp/9000/p2p/16Uiu2HAm5rokhpCBU7yBJHhMKXZ1xSVWwUcPMrzGKvU5Y7iBkmuK"
    );
  });

  it("should not extract bootMultiaddrs from enr without tcp", async () => {
    const enrWithoutTcp = [
      "enr:-Ku4QCFQW96tEDYPjtaueW3WIh1CB0cJnvw_ibx5qIFZGqfLLj-QajMX6XwVs2d4offuspwgH3NkIMpWtCjCytVdlywGh2F0dG5ldHOIEAIAAgABAUyEZXRoMpCi7FS9AQAAAAAiAQAAAAAAgmlkgnY0gmlwhFA4VK6Jc2VjcDI1NmsxoQNGH1sJJS86-0x9T7qQewz9Wn9zlp6bYxqqrR38JQ49yIN1ZHCCIyg",
    ];
    const bootMultiaddrs = await getDiscv5Multiaddrs(enrWithoutTcp);
    expect(bootMultiaddrs.length).toBe(0);
  });
});
