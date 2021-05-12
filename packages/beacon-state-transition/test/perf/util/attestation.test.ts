import {config} from "@chainsafe/lodestar-config/mainnet";
import {List, readonlyValues} from "@chainsafe/ssz";
import {expect} from "chai";
import {getAggregationBit, getAggregationBytes} from "../../../src";
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
  for (let i = 0; i < MAX_TRY; i++) {
    getAggregationBytes(config, tree);
  }
  logger.profile(`Access aggregationBits using getAggregationBytes ${MAX_TRY} times`);
  expect(readOnlyValuesResult).to.be.lt(
    14500,
    `Expect aggregationBits using readonlyValues ${MAX_TRY} times to be less than 14500ms`
  );
  expect(Date.now() - start).to.be.lt(820, `Expect getAggregationBytes ${MAX_TRY} times to be less than 820ms`);
});
