import {describe, it, expect} from "vitest";
import {bigIntToBytes} from "@lodestar/utils";
import {computeSubscribedSubnet} from "../../../../src/network/subnets/util.js";

describe("computeSubscribedSubnet", () => {
  // lighthouse's test cases https://github.com/sigp/lighthouse/blob/cc780aae3e0cb89649086a3b63cb02a4f97f7ae2/consensus/types/src/subnet_id.rs#L169
  // this goes with mainnet config
  const testCases: {nodeId: string; epoch: number; expected: number[]}[] = [
    {
      nodeId: "0",
      epoch: 54321,
      expected: [4, 5],
    },
    {
      nodeId: "88752428858350697756262172400162263450541348766581994718383409852729519486397",
      epoch: 1017090249,
      expected: [61, 62],
    },
    {
      nodeId: "18732750322395381632951253735273868184515463718109267674920115648614659369468",
      epoch: 1827566880,
      expected: [23, 24],
    },
    {
      nodeId: "27726842142488109545414954493849224833670205008410190955613662332153332462900",
      epoch: 846255942,
      expected: [38, 39],
    },
    {
      nodeId: "39755236029158558527862903296867805548949739810920318269566095185775868999998",
      epoch: 766597383,
      expected: [53, 54],
    },
    {
      nodeId: "31899136003441886988955119620035330314647133604576220223892254902004850516297",
      epoch: 1204990115,
      expected: [39, 40],
    },
    {
      nodeId: "58579998103852084482416614330746509727562027284701078483890722833654510444626",
      epoch: 1616209495,
      expected: [48, 49],
    },
    {
      nodeId: "28248042035542126088870192155378394518950310811868093527036637864276176517397",
      epoch: 1774367616,
      expected: [39, 40],
    },
    {
      nodeId: "60930578857433095740782970114409273483106482059893286066493409689627770333527",
      epoch: 1484598751,
      expected: [34, 35],
    },
    {
      nodeId: "103822458477361691467064888613019442068586830412598673713899771287914656699997",
      epoch: 3525502229,
      expected: [37, 38],
    },
  ];

  for (const [index, {nodeId, epoch, expected}] of testCases.entries()) {
    it(`test case ${index}`, () => {
      // node is is of type uint256 = 32 bytes
      expect(computeSubscribedSubnet(bigIntToBytes(BigInt(nodeId), 32, "be"), epoch)).toEqual(expected);
    });
  }
});
