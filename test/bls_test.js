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
		const domain = 0
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
      const secretBuf = Buffer.from(secret, 'hex').reverse()
      secret = secretBuf.toString('hex')
      const pubkeyBuf = Buffer.from(pubkey, 'hex').reverse()
      pubkey = pubkeyBuf.toString('hex')

      const s = new mcl.Fr()
      s.deserialize(secretBuf)
      assert(s instanceof mcl.Fr)
      assert(Buffer.from(s.serialize()).toString('hex') === secret)

      const P = bls.genPublic(s.serialize())
      const PHex = P.toString('hex')
      assert(pubkey === PHex, `incorrect deserialization, ${pubkey} should equal ${PHex}`)
      assert(P.length === 48, "calculated pubkey wrong length")
    }
	})

  it("should sign a message", () => {
		const secret = '263dbd792f5b1be47ed85f8938c0f29586af0d3ac7b977f21c278fe1462040e3'
		const s = new mcl.Fr()
    s.setStr(secret, 16)
    assert(s instanceof mcl.Fr)
    assert(s.getStr(16) === secret)

    const msg = keccak256(Buffer.from("6d657373616765", 'hex'))
    const domain = 0
	  const sig = bls.sign(Buffer.from(s.serialize()), msg, 0)
		assert(sig.length === 96)
	})

	it("should verify a signature", () => {
    const s = bls.genSecret()
    const P = bls.genPublic(s)
		const domain = 0
		const msg = keccak256(Buffer.from("hello", "hex"))
		const sig = bls.sign(s, msg, domain)
		assert(bls.verify(P, msg, sig, domain), "did not verify aggregated signature")
	})

  it("should aggregate pubkeys", () => {
    const P1 = new mcl.G1()
    P1.setHashOf("noot10")
    const P2 = new mcl.G1()
    P2.setHashOf("noot20")
    const aggregatedPubkey = bls.aggregatePubkeys([Buffer.from(P1.serialize()), Buffer.from(P2.serialize())])
    assert(aggregatedPubkey)
  })

	it("should aggregate signatures", () => {
		const sig1 = new mcl.G2()
		sig1.setHashOf("noot10")
		const sig2 = new mcl.G2()
		sig2.setHashOf("noot20")
		const aggregatedSig = bls.aggregateSignatures([Buffer.from(sig1.serialize()), Buffer.from(sig2.serialize())])
		assert(aggregatedSig)
	})

	it("should verify an aggregated signature of 1", () => {
    const s = bls.genSecret()
    const P = bls.genPublic(s)
		const domain = 0
		const msg = keccak256(Buffer.from("hello", "hex"))
		const sig = bls.sign(s, msg, domain)
		assert(bls.verifyMultiple([P], [msg], sig, domain), "did not verify aggregated signature")
	})

	it("should verify an aggregated signature of 2", () => {
    const s1 = bls.genSecret()
    const P1 = bls.genPublic(s1)
    const s2 = bls.genSecret()
    const P2 = bls.genPublic(s2)
		const domain = 0
		const msg = keccak256(Buffer.from("hello", "hex"))
		const sig1 = bls.sign(s1, msg, domain)
		const sig2 = bls.sign(s2, msg, domain)
		const aggregatedSig = bls.aggregateSignatures([sig1, sig2])
		assert(bls.verifyMultiple([P1, P2], [msg, msg], aggregatedSig, domain), "did not verify aggregated signature")
	})
})
