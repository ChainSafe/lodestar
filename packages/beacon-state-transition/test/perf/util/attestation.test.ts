import {config} from "@chainsafe/lodestar-config/mainnet";
import {intDiv} from "@chainsafe/lodestar-utils";
import {List, readonlyValues} from "@chainsafe/ssz";
import {expect} from "chai";
import {getAggregationBit, getAggregationBytes, PRE_COMPUTED_BYTE_TO_BOOLEAN_ARRAY} from "../../../src";
import {profilerLogger} from "../../utils/logger";

it("getAggregationBytes", function () {
  this.timeout(0);
  const aggregationBits = Array.from({length: config.params.MAX_VALIDATORS_PER_COMMITTEE}, () => true);
  const tree = config.types.phase0.CommitteeBits.createTreeBackedFromStruct(aggregationBits as List<boolean>);
  expect(Array.from(readonlyValues(tree))).to.be.deep.equal(aggregationBits);
  const aggregationBytes = getAggregationBytes(config, tree);
  const deserializedAggregationBits: boolean[] = [];
  for (let i = 0; i < aggregationBits.length; i++) {
    deserializedAggregationBits.push(getAggregationBit(aggregationBytes, i));
  }
  expect(deserializedAggregationBits).to.be.deep.equal(aggregationBits);
  const logger = profilerLogger();
  let start = Date.now();
  const MAX_TRY = 81920;
  logger.profile(`Access aggregationBits using readonlyValues ${MAX_TRY} times`);
  for (let i = 0; i < MAX_TRY; i++) {
    Array.from(readonlyValues(tree));
  }
  logger.profile(`Access aggregationBits using readonlyValues ${MAX_TRY} times`);
  const readOnlyValuesResult = Date.now() - start;
  logger.profile(`Access aggregationBits using getAggregationBytes ${MAX_TRY} times`);
  start = Date.now();
  let booleansInByte: boolean[] = [];
  for (let i = 0; i < MAX_TRY; i++) {
    const bytes = getAggregationBytes(config, tree);
    for (let j = 0; j < aggregationBits.length; j++) {
      const indexInByte = j % 8;
      if (indexInByte === 0) {
        const byte = bytes[intDiv(j, 8)];
        booleansInByte = PRE_COMPUTED_BYTE_TO_BOOLEAN_ARRAY[byte];
      }
      booleansInByte[indexInByte];
      // doing this gives same performance to readonlyValues
      // getAggregationBit(bytes, j);
    }
  }
  logger.profile(`Access aggregationBits using getAggregationBytes ${MAX_TRY} times`);
  expect(readOnlyValuesResult).to.be.lt(
    14500,
    `Expect aggregationBits using readonlyValues ${MAX_TRY} times to be less than 14500ms`
  );
  expect(Date.now() - start).to.be.lt(3100, `Expect getAggregationBytes ${MAX_TRY} times to be less than 3100ms`);
});
