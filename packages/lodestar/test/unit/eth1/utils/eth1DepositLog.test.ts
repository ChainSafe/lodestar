import {expect} from "chai";
import {assertConsecutiveDeposits} from "../../../../src/eth1/utils/eth1DepositLog";

describe("eth1 / util / assertConsecutiveDeposits", function () {
  const testCases: {
    id: string;
    ok: boolean;
    depositLogs: {index: number}[];
  }[] = [
    {
      id: "sequential deposits",
      ok: true,
      depositLogs: [{index: 4}, {index: 5}, {index: 6}],
    },
    {
      id: "non sequential deposits",
      ok: false,
      depositLogs: [{index: 4}, {index: 7}, {index: 9}],
    },
    {
      id: "sequential descending deposits",
      ok: false,
      depositLogs: [{index: 6}, {index: 5}, {index: 4}],
    },
    {
      id: "single deposit",
      ok: true,
      depositLogs: [{index: 4}],
    },
    {
      id: "empty array",
      ok: true,
      depositLogs: [],
    },
  ];

  for (const {id, ok, depositLogs} of testCases) {
    it(id, () => {
      if (ok) {
        assertConsecutiveDeposits(depositLogs);
      } else {
        expect(() => assertConsecutiveDeposits(depositLogs)).to.throw();
      }
    });
  }
});
