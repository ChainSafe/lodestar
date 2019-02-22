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

	it("should get deserialize a hex string to a secret key and the corresponding public key", () => {
		const secret = '263dbd792f5b1be47ed85f8938c0f29586af0d3ac7b977f21c278fe1462040e3'
		const pub = '9af7a7e5f618067c064d65771b0ce1d60fe2a6b9ff8d364f64e2e573a8c4ea2204ea0d4fe7f0897991bbd9ecb0d19104'
		const s = new mcl.Fr()
    s.setStr(secret, 16)
    assert(s instanceof mcl.Fr)
    assert(s.getStr(16) === secret)

    const P = bls.genPublic(s.serialize())

    assert(pub === P.toString('hex'), "incorrect deserialization")
    assert(P.length === 48, "wrong length")
	})

  it("should sign a message", () => {
		const secret = '263dbd792f5b1be47ed85f8938c0f29586af0d3ac7b977f21c278fe1462040e3'
		const s = new mcl.Fr()
    s.setStr(secret, 16)
    assert(s instanceof mcl.Fr)
    assert(s.getStr(16) === secret)

    const msg = Buffer.from("6d657373616765", 'hex')
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
