import "../setup.js";
import {expect} from "chai";
import {isPlainObject, objectToExpectedCase} from "../../src/index.js";

describe("Objects helper", () => {
  it("should be plain object", () => {
    expect(isPlainObject(Object.create({}))).to.equal(true);
    expect(isPlainObject(Object.create(Object.create(Object.prototype)))).to.equal(true);
    expect(isPlainObject({foo: "bar"})).to.equal(true);
    expect(isPlainObject({})).to.equal(true);
  });

  it("should not be plain object", () => {
    expect(isPlainObject(1)).to.equal(false);
    expect(isPlainObject(["foo", "bar"])).to.equal(false);
    expect(isPlainObject([])).to.equal(false);
    expect(isPlainObject(null)).to.equal(false);
  });
});

/* eslint-disable @typescript-eslint/naming-convention */

describe("objectToExpectedCase", () => {
  const testCases: {
    id: string;
    snake: Record<string, unknown>;
    camel: Record<string, unknown>;
  }[] = [
    {
      id: "nested object",
      snake: {
        prop_a: [
          {prop_a_a: 1, prop_a_b: "2"},
          {prop_a_a: 1, prop_a_b: "2"},
        ],
        prop_b: {
          prop_b_a: BigInt(1),
          prop_b_b: true,
        },
      },
      camel: {
        propA: [
          {propAA: 1, propAB: "2"},
          {propAA: 1, propAB: "2"},
        ],
        propB: {
          propBA: BigInt(1),
          propBB: true,
        },
      },
    },
  ];

  for (const {id, snake, camel} of testCases) {
    describe(id, () => {
      it("snake > camel", () => {
        expect(objectToExpectedCase(snake, "camel")).to.deep.equal(camel);
      });

      it("camel > snake", () => {
        expect(objectToExpectedCase(camel, "snake")).to.deep.equal(snake);
      });
    });
  }
});
