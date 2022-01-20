import {expect} from "chai";
import {ForkName} from "@chainsafe/lodestar-params";
import {IBeaconConfig, IForkInfo} from "@chainsafe/lodestar-config";
import {getCurrentAndNextFork, getActiveForks} from "../../../src/network/forks";

describe("network / fork: phase0: 0, altair: 0, bellatrix: Infinity", () => {
  const forks: Record<ForkName, IForkInfo> = {
    phase0: {
      name: ForkName.phase0,
      epoch: 0,
      version: Buffer.from([0, 0, 0, 0]),
    },
    altair: {
      name: ForkName.altair,
      epoch: 0,
      version: Buffer.from([0, 0, 0, 1]),
    },
    bellatrix: {
      name: ForkName.bellatrix,
      epoch: Infinity,
      version: Buffer.from([0, 0, 0, 2]),
    },
  };
  const forkConfig = {forks} as IBeaconConfig;
  it("should return altair on epoch -1, getActiveForks: altair", () => {
    expect(getCurrentAndNextFork(forkConfig, -1)).to.deep.equal({
      currentFork: forks[ForkName.altair],
      nextFork: undefined,
    });
    expect(getActiveForks(forkConfig, -1)).to.deep.equal(["altair"]);
  });
  it("should return altair on epoch 0, getActiveForks: altair", () => {
    expect(getCurrentAndNextFork(forkConfig, 0)).to.deep.equal({
      currentFork: forks[ForkName.altair],
      nextFork: undefined,
    });
    expect(getActiveForks(forkConfig, -1)).to.deep.equal(["altair"]);
  });
  it("should return altair on epoch 1, getActiveForks: altair", () => {
    expect(getCurrentAndNextFork(forkConfig, 1)).to.deep.equal({
      currentFork: forks[ForkName.altair],
      nextFork: undefined,
    });
    expect(getActiveForks(forkConfig, -1)).to.deep.equal(["altair"]);
  });
});

describe("network / fork: phase0: 0, altair: 0, bellatrix: 0", () => {
  const forks: Record<ForkName, IForkInfo> = {
    phase0: {
      name: ForkName.phase0,
      epoch: 0,
      version: Buffer.from([0, 0, 0, 0]),
    },
    altair: {
      name: ForkName.altair,
      epoch: 0,
      version: Buffer.from([0, 0, 0, 1]),
    },
    bellatrix: {
      name: ForkName.bellatrix,
      epoch: 0,
      version: Buffer.from([0, 0, 0, 2]),
    },
  };
  const forkConfig = {forks} as IBeaconConfig;
  it("should return bellatrix on epoch -1, getActiveForks: bellatrix", () => {
    expect(getCurrentAndNextFork(forkConfig, -1)).to.deep.equal({
      currentFork: forks[ForkName.bellatrix],
      nextFork: undefined,
    });
    expect(getActiveForks(forkConfig, -1)).to.deep.equal(["bellatrix"]);
  });
  it("should return bellatrix on epoch 0, getActiveForks: bellatrix", () => {
    expect(getCurrentAndNextFork(forkConfig, 0)).to.deep.equal({
      currentFork: forks[ForkName.bellatrix],
      nextFork: undefined,
    });
    expect(getActiveForks(forkConfig, 0)).to.deep.equal(["bellatrix"]);
  });
});

describe("network / fork: phase0: 0, altair: 1, bellatrix: 1", () => {
  const forks: Record<ForkName, IForkInfo> = {
    phase0: {
      name: ForkName.phase0,
      epoch: 0,
      version: Buffer.from([0, 0, 0, 0]),
    },
    altair: {
      name: ForkName.altair,
      epoch: 1,
      version: Buffer.from([0, 0, 0, 1]),
    },
    bellatrix: {
      name: ForkName.bellatrix,
      epoch: 1,
      version: Buffer.from([0, 0, 0, 2]),
    },
  };
  const forkConfig = {forks} as IBeaconConfig;
  it("should return phase0,bellatrix  on epoch -1, getActiveForks: phase0, bellatrix", () => {
    expect(getCurrentAndNextFork(forkConfig, -1)).to.deep.equal({
      currentFork: forks[ForkName.phase0],
      nextFork: forks[ForkName.bellatrix],
    });
    expect(getActiveForks(forkConfig, -1)).to.deep.equal(["phase0", "bellatrix"]);
  });
  it("should return phase0,bellatrix  on epoch 0, getActiveForks: phase0, bellatrix", () => {
    expect(getCurrentAndNextFork(forkConfig, 0)).to.deep.equal({
      currentFork: forks[ForkName.phase0],
      nextFork: forks[ForkName.bellatrix],
    });
    expect(getActiveForks(forkConfig, 0)).to.deep.equal(["phase0", "bellatrix"]);
  });
  it("should return bellatrix on epoch 2, getActiveForks: phase0, bellatrix", () => {
    expect(getCurrentAndNextFork(forkConfig, 2)).to.deep.equal({
      currentFork: forks[ForkName.bellatrix],
      nextFork: undefined,
    });
    expect(getActiveForks(forkConfig, 2)).to.deep.equal(["phase0", "bellatrix"]);
  });
  it("should return bellatrix on epoch 3, getActiveForks: phase0,bellatrix", () => {
    expect(getCurrentAndNextFork(forkConfig, 3)).to.deep.equal({
      currentFork: forks[ForkName.bellatrix],
      nextFork: undefined,
    });
    expect(getActiveForks(forkConfig, 3)).to.deep.equal(["phase0", "bellatrix"]);
  });
  it("should return bellatrix on epoch 4, getActiveForks: bellatrix", () => {
    expect(getCurrentAndNextFork(forkConfig, 4)).to.deep.equal({
      currentFork: forks[ForkName.bellatrix],
      nextFork: undefined,
    });
    expect(getActiveForks(forkConfig, 4)).to.deep.equal(["bellatrix"]);
  });
});

describe("network / fork: phase0: 0, altair: 1, bellatrix: 2", () => {
  const forks: Record<ForkName, IForkInfo> = {
    phase0: {
      name: ForkName.phase0,
      epoch: 0,
      version: Buffer.from([0, 0, 0, 0]),
    },
    altair: {
      name: ForkName.altair,
      epoch: 1,
      version: Buffer.from([0, 0, 0, 1]),
    },
    bellatrix: {
      name: ForkName.bellatrix,
      epoch: 2,
      version: Buffer.from([0, 0, 0, 2]),
    },
  };
  const forkConfig = {forks} as IBeaconConfig;
  it("should return phase0,altair  on epoch -1, getActiveForks: phase0, altair", () => {
    expect(getCurrentAndNextFork(forkConfig, -1)).to.deep.equal({
      currentFork: forks[ForkName.phase0],
      nextFork: forks[ForkName.altair],
    });
    expect(getActiveForks(forkConfig, -1)).to.deep.equal(["phase0", "altair"]);
  });
  it("should return phase0,altair  on epoch 0, getActiveForks: phase0, altair, bellatrix", () => {
    expect(getCurrentAndNextFork(forkConfig, 0)).to.deep.equal({
      currentFork: forks[ForkName.phase0],
      nextFork: forks[ForkName.altair],
    });
    expect(getActiveForks(forkConfig, 0)).to.deep.equal(["phase0", "altair", "bellatrix"]);
  });
  it("should return altair,bellatrix on epoch 1, getActiveForks: phase0, altair, bellatrix", () => {
    expect(getCurrentAndNextFork(forkConfig, 1)).to.deep.equal({
      currentFork: forks[ForkName.altair],
      nextFork: forks[ForkName.bellatrix],
    });
    expect(getActiveForks(forkConfig, 1)).to.deep.equal(["phase0", "altair", "bellatrix"]);
  });
  it("should return bellatrix on epoch 2, getActiveForks: phase0, altair, bellatrix", () => {
    expect(getCurrentAndNextFork(forkConfig, 2)).to.deep.equal({
      currentFork: forks[ForkName.bellatrix],
      nextFork: undefined,
    });
    expect(getActiveForks(forkConfig, 2)).to.deep.equal(["phase0", "altair", "bellatrix"]);
  });
  it("should return bellatrix on epoch 3, getActiveForks: phase0, altair, bellatrix", () => {
    expect(getCurrentAndNextFork(forkConfig, 3)).to.deep.equal({
      currentFork: forks[ForkName.bellatrix],
      nextFork: undefined,
    });
    expect(getActiveForks(forkConfig, 3)).to.deep.equal(["phase0", "altair", "bellatrix"]);
  });
  it("should return bellatrix on epoch 4, getActiveForks: altair, bellatrix", () => {
    expect(getCurrentAndNextFork(forkConfig, 4)).to.deep.equal({
      currentFork: forks[ForkName.bellatrix],
      nextFork: undefined,
    });
    expect(getActiveForks(forkConfig, 4)).to.deep.equal(["altair", "bellatrix"]);
  });
  it("should return bellatrix on epoch 5, getActiveForks: bellatrix", () => {
    expect(getCurrentAndNextFork(forkConfig, 5)).to.deep.equal({
      currentFork: forks[ForkName.bellatrix],
      nextFork: undefined,
    });
    expect(getActiveForks(forkConfig, 5)).to.deep.equal(["bellatrix"]);
  });
});

describe("network / fork: phase0: 0, altair: 5, bellatrix: 10", () => {
  const forks: Record<ForkName, IForkInfo> = {
    phase0: {
      name: ForkName.phase0,
      epoch: 0,
      version: Buffer.from([0, 0, 0, 0]),
    },
    altair: {
      name: ForkName.altair,
      epoch: 5,
      version: Buffer.from([0, 0, 0, 1]),
    },
    bellatrix: {
      name: ForkName.bellatrix,
      epoch: 10,
      version: Buffer.from([0, 0, 0, 2]),
    },
  };
  const forkConfig = {forks} as IBeaconConfig;
  it("should return phase0,altair  on epoch -1, getActiveForks: phase0", () => {
    expect(getCurrentAndNextFork(forkConfig, -1)).to.deep.equal({
      currentFork: forks[ForkName.phase0],
      nextFork: forks[ForkName.altair],
    });
    expect(getActiveForks(forkConfig, -1)).to.deep.equal(["phase0"]);
  });

  it("should return phase0,altair  on epoch 3, getActiveForks: phase0,altair", () => {
    expect(getCurrentAndNextFork(forkConfig, 3)).to.deep.equal({
      currentFork: forks[ForkName.phase0],
      nextFork: forks[ForkName.altair],
    });
    expect(getActiveForks(forkConfig, 3)).to.deep.equal(["phase0", "altair"]);
  });

  it("should return altair,bellatrix  on epoch 7, getActiveForks: phase0,altair", () => {
    expect(getCurrentAndNextFork(forkConfig, 7)).to.deep.equal({
      currentFork: forks[ForkName.altair],
      nextFork: forks[ForkName.bellatrix],
    });
    expect(getActiveForks(forkConfig, 7)).to.deep.equal(["phase0", "altair"]);
  });

  it("should return altair,bellatrix  on epoch 8, getActiveForks: altair,bellatrix", () => {
    expect(getCurrentAndNextFork(forkConfig, 8)).to.deep.equal({
      currentFork: forks[ForkName.altair],
      nextFork: forks[ForkName.bellatrix],
    });
    expect(getActiveForks(forkConfig, 8)).to.deep.equal(["altair", "bellatrix"]);
  });

  it("should return bellatrix  on epoch 11, getActiveForks: altair,bellatrix", () => {
    expect(getCurrentAndNextFork(forkConfig, 11)).to.deep.equal({
      currentFork: forks[ForkName.bellatrix],
      nextFork: undefined,
    });
    expect(getActiveForks(forkConfig, 11)).to.deep.equal(["altair", "bellatrix"]);
  });

  it("should return bellatrix  on epoch 12, getActiveForks: altair,bellatrix", () => {
    expect(getCurrentAndNextFork(forkConfig, 12)).to.deep.equal({
      currentFork: forks[ForkName.bellatrix],
      nextFork: undefined,
    });
    expect(getActiveForks(forkConfig, 12)).to.deep.equal(["altair", "bellatrix"]);
  });

  it("should return bellatrix  on epoch 13, getActiveForks: bellatrix", () => {
    expect(getCurrentAndNextFork(forkConfig, 13)).to.deep.equal({
      currentFork: forks[ForkName.bellatrix],
      nextFork: undefined,
    });
    expect(getActiveForks(forkConfig, 13)).to.deep.equal(["bellatrix"]);
  });
});
