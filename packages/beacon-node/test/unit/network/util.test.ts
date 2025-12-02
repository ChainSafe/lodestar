import {afterEach, describe, expect, it} from "vitest";
import {config} from "@lodestar/config/default";
import {ForkName} from "@lodestar/params";
import {getCurrentAndNextForkBoundary} from "../../../src/network/forks.js";
import {getDiscv5Multiaddrs} from "../../../src/network/libp2p/index.js";

describe("getCurrentAndNextForkBoundary", () => {
  const altairEpoch = config.forkBoundariesAscendingEpochOrder[1].epoch;
  afterEach(() => {
    config.forkBoundariesAscendingEpochOrder[1].epoch = altairEpoch;
  });

  it("should return no next fork boundary if altair epoch is infinity", () => {
    config.forkBoundariesAscendingEpochOrder[1].epoch = Infinity;
    const {currentBoundary, nextBoundary} = getCurrentAndNextForkBoundary(config, 0);
    expect(currentBoundary.fork).toBe(ForkName.phase0);
    expect(nextBoundary).toBeUndefined();
  });

  it("should return altair as next fork boundary and then bellatrix", () => {
    config.forkBoundariesAscendingEpochOrder[1].epoch = 1000;
    let boundaries = getCurrentAndNextForkBoundary(config, 0);
    expect(boundaries.currentBoundary.fork).toBe(ForkName.phase0);
    if (boundaries.nextBoundary) {
      expect(boundaries.nextBoundary.fork).toBe(ForkName.altair);
    } else {
      expect.fail("No next fork");
    }

    boundaries = getCurrentAndNextForkBoundary(config, 1000);
    expect(boundaries.currentBoundary.fork).toBe(ForkName.altair);
    expect(boundaries.nextBoundary?.fork).toBe(ForkName.bellatrix);
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
