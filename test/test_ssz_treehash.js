const assert = require('chai').assert
const BN = require('bn.js')

const hexToBytes = require('./utils/hexToBytes').hexToBytes
const treeHash = require('../src').treeHash
const merkleHash = require('../src').merkleHash
const testObjects = require('./utils/objects')

const SimpleObject = testObjects.SimpleObject
const OuterObject = testObjects.OuterObject
const InnerObject = testObjects.InnerObject
const ArrayObject = testObjects.ArrayObject


describe('SimpleSerialize - tree hashes', () => {
  const testCases = [
    // bool
    [[false, 'bool'], '0000000000000000000000000000000000000000000000000000000000000000'],
    [[true, 'bool'], '0100000000000000000000000000000000000000000000000000000000000000'],
    // uint
    [[0, 'uint8'], "0000000000000000000000000000000000000000000000000000000000000000"],
    [[1, 'uint8'], "0100000000000000000000000000000000000000000000000000000000000000"],
    [[16, 'uint8'], "1000000000000000000000000000000000000000000000000000000000000000"],
    [[128, 'uint8'], "8000000000000000000000000000000000000000000000000000000000000000"],
    [[255, 'uint8'], "ff00000000000000000000000000000000000000000000000000000000000000"],
    [[0, 'uint16'], "0000000000000000000000000000000000000000000000000000000000000000"],
    [[1, 'uint16'], "0001000000000000000000000000000000000000000000000000000000000000"],
    [[16, 'uint16'], "0010000000000000000000000000000000000000000000000000000000000000"],
    [[128, 'uint16'], "0080000000000000000000000000000000000000000000000000000000000000"],
    [[255, 'uint16'], "00ff000000000000000000000000000000000000000000000000000000000000"],
    [[65535, 'uint16'], "ffff000000000000000000000000000000000000000000000000000000000000"],
    [[0, 'uint32'], "0000000000000000000000000000000000000000000000000000000000000000"],
    [[1, 'uint32'], "0000000100000000000000000000000000000000000000000000000000000000"],
    [[16, 'uint32'], "0000001000000000000000000000000000000000000000000000000000000000"],
    [[128, 'uint32'], "0000008000000000000000000000000000000000000000000000000000000000"],
    [[255, 'uint32'], "000000ff00000000000000000000000000000000000000000000000000000000"],
    [[65535, 'uint32'], "0000ffff00000000000000000000000000000000000000000000000000000000"],
    [[4294967295, 'uint32'], "ffffffff00000000000000000000000000000000000000000000000000000000"],
    [[0, 'uint64'], "0000000000000000000000000000000000000000000000000000000000000000"],
    [[1, 'uint64'], "0000000000000001000000000000000000000000000000000000000000000000"],
    [[16, 'uint64'], "0000000000000010000000000000000000000000000000000000000000000000"],
    [[128, 'uint64'], "0000000000000080000000000000000000000000000000000000000000000000"],
    [[255, 'uint64'], "00000000000000ff000000000000000000000000000000000000000000000000"],
    [[65535, 'uint64'], "000000000000ffff000000000000000000000000000000000000000000000000"],
    [[4294967295, 'uint64'], "00000000ffffffff000000000000000000000000000000000000000000000000"],
    [[new BN('18446744073709551615'), 'uint64'], "ffffffffffffffff000000000000000000000000000000000000000000000000"],
    // bytes
    [[Buffer.alloc(0), 'bytes'],'e8e77626586f73b955364c7b4bbf0bb7f7685ebd40e852b164633a4acbd3244c'],
    [[Buffer.from([1]), 'bytes'], 'a01f051be047843977f523e7944513ebbedd5568cc9911c955850f3cccc6979f'],
    [[Buffer.from([1, 2, 3, 4, 5, 6]), 'bytes'], 'bd72911f3235f1e8bbc9f01c95526ae0c7afe1e7c0e13429cc3e8ee307516b7e'],
    // array
    [[[], ['uint16']], 'dfded4ed5ac76ba7379cfe7b3b0f53e768dca8d45a34854e649cfc3c18cbd9cd'],
    [[[1], ['uint16']], '75848bb7f08d2e009e76fdad5a1c6129e48df34d81245405f9c43b53d204dfaf'],
    [[[1, 2], ['uint16']], '02a9991b320fd848fdff2e069ff4a6e2b2a593fa13c32201ec89d5272332908d'],
    [[[[1,2,3,4],[5,6,7,8]], [['uint16']]], 'd779c77e9e3fe29311097a0d62aa55077c2accc2ce89d6c3024877ca73222bb3'],
    // object
    [[new SimpleObject({b:0,a:0}), SimpleObject], '99ff0d9125e1fc9531a11262e15aeb2c60509a078c4cc4c64cefdfb06ff68647'],
    [[new SimpleObject({b:2,a:1}), SimpleObject], 'd841aa2ce38fda992d162d973ebd62cf0c74522f8feb294c48a03d4db0a6b78c'],
    [[new OuterObject({v:3,subV: new InnerObject({v:6})}), OuterObject], '22e310a4b644fbcf2a8f90ac1a5311ed9070e6c9e68a2fe58082bbf78c0d030e'],
    [[new ArrayObject({v: [new SimpleObject({b:2,a:1}), new SimpleObject({b:4,a:3})]}), ArrayObject], 'c338a2c69762d374cf6453ddf9b1d685d75243cf59b1fdd9a4df4db623e80512'],
    [[[new OuterObject({v:3,subV: new InnerObject({v:6})}), new OuterObject({v:5,subV: new InnerObject({v:7})})], [OuterObject]], 'd568df03934c0ee51f49aabe81f20844d2f44159c389411bbc0c6008d5d85395'],
  ]
  const stringifyType = type => {
    if (typeof type === 'string') {
      return type
    } else if (Array.isArray(type)) {
      return `[${stringifyType(type[0])}]`
    } else if (typeof type === 'function') {
      return type.name
    } else return ''
  }
  for (const [input, output] of testCases) {
    const [value, type] = input
    it(`successfully tree hashes ${stringifyType(type)}`, () => {
      assert.equal(treeHash(value, type).toString('hex'), output)
    })
  }
})

describe('SimpleSerialize - merkle hashes', () => {
  const testCases = [
    [[], 'dfded4ed5ac76ba7379cfe7b3b0f53e768dca8d45a34854e649cfc3c18cbd9cd'],
    [[Buffer.from([1,2]), Buffer.from([3,4])], 'd065b8cb25f0c84c86028fe9c3de7bf08262d5188aa6b0b6aa8781513399262e'],
    [[1,2,3,4,5,6,7,8,9,10].map(i => Buffer.alloc(16,i)), '359d4da50d11cdc0bac57dc4888e60c0acaa0498f76050e5e50ce0a51466ceee'],
    [[1,2,3,4,5,6,7,8,9,10].map(i => Buffer.alloc(32,i)), '21c56180c7ccc7be1bb5a4a27117a61dcee85d7009f2241e77587387fe5c5a46'],
  ]
  for (const [input, output] of testCases) {
    it('successfully merkle hashes', () => {
      assert.equal(merkleHash(input).toString('hex'), output)
    })
  }
})

