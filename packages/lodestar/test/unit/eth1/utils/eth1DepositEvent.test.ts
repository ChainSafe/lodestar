import {expect} from "chai";
import {assertConsecutiveDeposits} from "../../../../src/eth1/utils/eth1DepositEvent";

describe("eth1 / util / assertConsecutiveDeposits", function () {
  const testCases: {
    id: string;
    ok: boolean;
    depositEvents: {index: number}[];
  }[] = [
    {
      id: "sequential deposits",
      ok: true,
      depositEvents: [{index: 4}, {index: 5}, {index: 6}],
    },
    {
      id: "non sequential deposits",
      ok: false,
      depositEvents: [{index: 4}, {index: 7}, {index: 9}],
    },
    {
      id: "sequential descending deposits",
      ok: false,
      depositEvents: [{index: 6}, {index: 5}, {index: 4}],
    },
    {
      id: "single deposit",
      ok: true,
      depositEvents: [{index: 4}],
    },
    {
      id: "empty array",
      ok: true,
      depositEvents: [],
    },
  ];

  for (const {id, ok, depositEvents} of testCases) {
    it(id, () => {
      if (ok) {
        assertConsecutiveDeposits(depositEvents);
      } else {
        expect(() => assertConsecutiveDeposits(depositEvents)).to.throw();
      }
    });
  }
});
