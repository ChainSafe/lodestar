import {expect} from "chai";
import {Vector} from "../../src/Vector";

it("should be able to handle 10M elements", function () {
  this.timeout(0);
  let start = Date.now();
  let acc = Vector.empty<number>();
  const times = 10000000;
  for (let i = 0; i < times; ++i) {
    acc = acc.append(i);
  }
  expect(acc.length).to.be.equal(times);
  console.log(`Finish append ${times} items in`, Date.now() - start);
  start = Date.now();
  let index = 0;
  for (const _ of acc) {
    // expect(item).to.be.equal(index);
    index++;
  }
  expect(index).to.be.equal(times);
  console.log(`Finish regular iterator ${times} in`, Date.now() - start);
  // start = Date.now();
  // for (let i = 0; i < times; ++i) {
  //   expect(acc.get(i)).to.be.equal(i);
  // }
  // console.log(`Finish regular for of ${times} items in`, Date.now() - start);
  start = Date.now();
  let count = 0;
  acc.readOnlyForEach(() => {
    count++;
  });
  expect(count).to.be.equal(times);
  console.log(`Finish readOnlyForEach of ${times} items in`, Date.now() - start);
  start = Date.now();
  const tsArray = acc.toTS();
  expect(tsArray.length).to.be.equal(times);
  console.log(`Finish toTS of ${times} items in`, Date.now() - start);
  start = Date.now();
  const newArr = acc.readOnlyMap<number>((v) => v * 2);
  console.log(`Finish readOnlyMap of ${times} items in`, Date.now() - start);
  expect(newArr[1]).to.be.equal(2);
  expect(newArr.length).to.be.equal(times);
  start = Date.now();
  const newArr2 = tsArray.map((v) => v * 2);
  console.log(`Finish regular map of regular array of ${times} items in`, Date.now() - start);
  expect(newArr).to.be.deep.equal(newArr2);
});
