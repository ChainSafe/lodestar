const intByteLength = require("../src/intBytes").intByteLength;
const assert = require('chai').assert

describe("SSZ Helper Functions", () => {
  describe("intByteLength", () => {
    it("should return size 32 for int32", () => {
      const res = intByteLength('int32')
      assert(4 === res, `Got: ${res}, expected: ${4}`)
    });

    it("should error on int23 (not a multiple of 8)", () => {
      try {
        const res = intByteLength('int23')
        assert.fail('No error thrown')
      } catch (e) {
        assert(e.message === 'given int type has invalid size, must be size > 0 and size % 8 == 0',
          `wrong error thrown: ${e.message}`)
      }
    })
  })
})