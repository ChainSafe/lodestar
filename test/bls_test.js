const assert = require("chai").assert
const keccak256 = require("keccak256")
const mcl = require("mcl-wasm")

const bls = require("../")

describe("bls", () => {
  before(async() => {
    await bls.init()
  })

  it("should create generator for G1", () => {
    const g = bls.g1()
    assert(!g.isZero(), "did not create G1 generator")
  })

  it("should hash message to G2", () => {
    const domain = Buffer.alloc(8)
    const message = keccak256(Buffer.from('6d657373616765', 'hex'))
    assert(bls.hashToG2(message, domain))
  })

  it("should generate a secret key", () => {
    const s = bls.genSecret()
    assert(s.length === 32 && !s.equals(Buffer.alloc(32)))
  })

  it("should get the corresponding public key to a secret key", () => {
    const s = bls.genSecret()
    const P = bls.genPublic(s)
    assert.equal(s.length, 32)
    assert.equal(P.length, 48)
  })

  it("should generate the correct public key from a secret key", () => {
    // test cases from: https://github.com/ethereum/eth2.0-tests/blob/master/bls/test_bls.yml
    const testCases = [
      {secret: '263dbd792f5b1be47ed85f8938c0f29586af0d3ac7b977f21c278fe1462040e3',
       pubkey: '0491d1b0ecd9bb917989f0e74f0dea0422eac4a873e5e2644f368dffb9a6e20fd6e10c1b77654d067c0618f6e5a7f79a'},
      {secret: '47b8192d77bf871b62e87859d653922725724a5c031afeabc60bcef5ff665138',
       pubkey: '1301803f8b5ac4a1133581fc676dfedc60d891dd5fa99028805e5ea5b08d3491af75d0707adab3b70c6a6a580217bf81'},
      {secret: '328388aff0d4a5b7dc9205abd374e7e98f3cd9f3418edb4eafda5fb16473d216',
       pubkey: '153d21a4cfd562c469cc81514d4ce5a6b577d8403d32a394dc265dd190b47fa9f829fdd7963afdf972e5e77854051f6f'},
    ]
    for (let {secret, pubkey} of testCases) {
      const secretBuf = Buffer.from(secret, 'hex')
      const pubkeyBuf = Buffer.from(pubkey, 'hex')

      const P = bls.genPublic(secretBuf)
      const PHex = P.toString('hex')

      assert.equal(P.length, 48, "calculated pubkey wrong length")
      assert.equal(pubkey, PHex, "incorrect deserialization")
    }
  })

  it("should sign a message", () => {
    const secret = '263dbd792f5b1be47ed85f8938c0f29586af0d3ac7b977f21c278fe1462040e3'
    const secretBuf = Buffer.from(secret, 'hex')
    const msg = keccak256(Buffer.from("6d657373616765", 'hex'))
    const domain = Buffer.alloc(8)
    const sig = bls.sign(secretBuf, msg, domain)
    assert.equal(sig.length, 96)
  })

  it("should verify a signature", () => {
    const s = bls.genSecret()
    const P = bls.genPublic(s)
    const domain = Buffer.alloc(8)
    const msg = keccak256(Buffer.from("hello", "hex"))
    const sig = bls.sign(s, msg, domain)
    assert(bls.verify(P, msg, sig, domain), "did not verify aggregated signature")
  })

  it("should aggregate pubkeys", () => {
    const s1 = bls.genSecret()
    const P1 = bls.genPublic(s1)
    const s2 = bls.genSecret()
    const P2 = bls.genPublic(s2)
    const aggregatedPubkey = bls.aggregatePubkeys([P1, P2])
    assert(aggregatedPubkey)
  })

  it("should aggregate signatures", () => {
    const s1 = bls.genSecret()
    const P1 = bls.genPublic(s1)
    const s2 = bls.genSecret()
    const P2 = bls.genPublic(s2)
    const domain = Buffer.alloc(8)
    const msg = keccak256(Buffer.from("hello", "hex"))
    const sig1 = bls.sign(s1, msg, domain)
    const sig2 = bls.sign(s2, msg, domain)
    const aggregatedSig = bls.aggregateSignatures([sig1, sig2])
    assert(aggregatedSig)
  })

  it("should verify an aggregated signature of 1", () => {
    const s = bls.genSecret()
    const P = bls.genPublic(s)
    const domain = Buffer.alloc(8)
    const msg = keccak256(Buffer.from("hello", "hex"))
    const sig = bls.sign(s, msg, domain)
    assert(bls.verifyMultiple([P], [msg], sig, domain), "did not verify aggregated signature")
  })

  it("should verify an aggregated signature of 2", () => {
    const s1 = bls.genSecret()
    const P1 = bls.genPublic(s1)
    const s2 = bls.genSecret()
    const P2 = bls.genPublic(s2)
    const domain = Buffer.alloc(8)
    const msg = keccak256(Buffer.from("hello", "hex"))
    const sig1 = bls.sign(s1, msg, domain)
    const sig2 = bls.sign(s2, msg, domain)
    const aggregatedSig = bls.aggregateSignatures([sig1, sig2])
    assert(bls.verifyMultiple([P1, P2], [msg, msg], aggregatedSig, domain), "did not verify aggregated signature")
  })
})
