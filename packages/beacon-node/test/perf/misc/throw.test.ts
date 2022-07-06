import {itBench} from "@dapplion/benchmark";

describe("misc / throw vs return", () => {
  const count = 10000;

  type Status = {code: string; value: number};

  function statusReturn(i: number): Status {
    return {
      code: "OK",
      value: i,
    };
  }

  class ErrorStatus extends Error implements Status {
    constructor(readonly code: string, readonly value: number) {
      super(code);
    }
  }

  function statusThrow(i: number): never {
    throw new ErrorStatus("OK", i);
  }

  itBench({
    id: `Return object ${count} times`,
    noThreshold: true,
    runsFactor: count,
    fn: () => {
      for (let i = 0; i < count; i++) {
        const res = statusReturn(i);
        res.code;
      }
    },
  });

  itBench({
    id: `Throw Error ${count} times`,
    noThreshold: true,
    runsFactor: count,
    fn: () => {
      for (let i = 0; i < count; i++) {
        try {
          statusThrow(i);
        } catch (e) {
          (e as Status).code;
        }
      }
    },
  });
});
