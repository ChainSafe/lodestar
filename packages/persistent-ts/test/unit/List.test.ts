import fc from "fast-check";
import {expect} from "chai";
import {List} from "../../src/List";

it("List.empty isEmpty", () => {
  const empty = List.empty();
  expect(empty.isEmpty()).to.be.true;
});

it("List.singleton is not Empty", () => {
  const singleton = List.of(1);
  expect(singleton.isEmpty()).to.be.false;
});

it("List.equals works", () => {
  const empty = List.empty<number>();
  const single1 = List.of(1);
  const single2 = List.of(2);
  expect(single1.equals(empty)).to.be.false;
  expect(single1.equals(single2)).to.be.false;
  expect(empty.equals(empty)).to.be.true;
  expect(single1.equals(single1)).to.be.true;
});

it("List.prepend works", () => {
  const single1 = List.of(1);
  const prepend1 = List.empty().prepend(1);
  expect(prepend1.equals(single1)).to.be.true;
  expect(single1.prepend(1).equals(single1)).to.be.false;
});

it("List is iterable", () => {
  const array = [1, 2, 3];
  const list = List.of(...array);
  expect(Array.from(list)).to.be.deep.equal(array);
  expect(Array.from(List.empty())).to.be.deep.equal([]);
  expect(List.of(...list).equals(list)).to.be.true;
});

it("List.head works", () => {
  expect(List.empty().head()).to.be.null;
  expect(List.of(1).head()).to.be.equal(1);
});

it("List.tail works", () => {
  const empty = List.empty();
  expect(empty.tail().equals(empty)).to.be.true;
});

it("List.take works", () => {
  const empty = List.empty<number>();
  const simple = List.of(1, 2, 3);
  expect(simple.take(0).equals(empty)).to.be.true;
  expect(simple.take(0).equals(simple)).to.be.false;
  expect(simple.take(3).equals(simple)).to.be.true;
  expect(simple.take(1).equals(List.of(1))).to.be.true;
});

it("List.drop works", () => {
  const empty = List.empty<number>();
  expect(empty.drop(0).equals(empty)).to.be.true;
  expect(empty.drop(1).equals(empty)).to.be.true;
  const simple = List.of(1, 2, 3);
  expect(simple.drop(3).equals(empty)).to.be.true;
  expect(simple.drop(1).equals(List.of(2, 3))).to.be.true;
});

it("List.prepend properties", () => {
  fc.assert(
    fc.property(fc.array(fc.integer()), (data) => {
      const list = List.of(...data);
      const value = 1;
      const extra = list.prepend(value);
      expect(extra.tail().equals(list)).to.be.true;
      expect(extra.head()).to.be.equal(value);
    })
  );
});

it("List can be reassembled from take and drop", () => {
  const gen = fc.tuple(fc.array(fc.integer()), fc.nat());
  fc.assert(
    fc.property(gen, ([items, amount]) => {
      const list = List.of(items);
      const left = list.take(amount);
      const right = list.drop(amount);
      expect(left.concat(right).equals(list)).to.be.true;
    })
  );
});
