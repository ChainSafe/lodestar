import {describe, it, expect} from "vitest";
import {bigIntToBytes} from "@lodestar/utils";
import {ATTESTATION_SUBNET_PREFIX_BITS, NODE_ID_BITS} from "@lodestar/params";
import {getNodeIdPrefix, getNodeOffset} from "../../../../src/network/subnets/util.js";

const nodeIds: string[] = [
  "0",
  "88752428858350697756262172400162263450541348766581994718383409852729519486397",
  "18732750322395381632951253735273868184515463718109267674920115648614659369468",
  "27726842142488109545414954493849224833670205008410190955613662332153332462900",
  "39755236029158558527862903296867805548949739810920318269566095185775868999998",
  "31899136003441886988955119620035330314647133604576220223892254902004850516297",
  "58579998103852084482416614330746509727562027284701078483890722833654510444626",
  "28248042035542126088870192155378394518950310811868093527036637864276176517397",
  "60930578857433095740782970114409273483106482059893286066493409689627770333527",
  "103822458477361691467064888613019442068586830412598673713899771287914656699997",
];

describe("getNodeIdPrefix", () => {
  for (const [index, nodeId] of nodeIds.entries()) {
    it(`test case ${index}`, () => {
      const nodeIdBigInt = BigInt(nodeId);
      // nodeId is of type uint256, which is 32 bytes
      const nodeIdBytes = bigIntToBytes(nodeIdBigInt, 32, "be");
      expect(getNodeIdPrefix(nodeIdBytes)).toBe(
        Number(nodeIdBigInt >> BigInt(NODE_ID_BITS - ATTESTATION_SUBNET_PREFIX_BITS))
      );
    });
  }
});

describe("getNodeOffset", () => {
  for (const [index, nodeId] of nodeIds.entries()) {
    it(`test case ${index}`, () => {
      const nodeIdBigInt = BigInt(nodeId);
      // nodeId is of type uint256, which is 32 bytes
      const nodeIdBytes = bigIntToBytes(nodeIdBigInt, 32, "be");
      expect(getNodeOffset(nodeIdBytes)).toBe(Number(nodeIdBigInt % BigInt(256)));
    });
  }
});
