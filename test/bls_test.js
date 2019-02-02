const bls = require("../")
const mcl = require("mcl-wasm")
const assert = require("chai").assert

describe("bls", () => {
	beforeEach(async() => {
		await mcl.init(mcl.BLS12_381)
	})

	it("should create base point for G1", async() => {
        let q = bls.Q()
        assert(!q.isZero(), "did not create G1 base point")
	})

	it("should generate a secret key", async() => {
        let s = bls.gen_secret()
        assert(s instanceof mcl.Fr && !s.isZero())
	})

	it("should get the corresponding public key to a secret key", async() => {
        let s = bls.gen_secret()
        //`console.log(s.serializeToHexStr())
        let P = bls.gen_public(s)
        assert(s instanceof mcl.Fr)
        assert(P instanceof mcl.G1)
	})

	it("should get deserialize a hex string to a secret key and the corresponding public key", async() => {
        let s = mcl.deserializeHexStrToFr('263dbd792f5b1be47ed85f8938c0f29586af0d3ac7b977f21c278fe1462040e3')
        console.log(s.serializeToHexStr())
        assert(s instanceof mcl.Fr)
	})

	it("should sign a message", async() => {
        let s = bls.gen_secret()
        let P = bls.gen_public(s)
        let msg = "noot"
		let sig = bls.sign(s, msg)
		assert(sig instanceof mcl.G2)
	})

	it("should verify a signature", async() => {
        let s = bls.gen_secret()
        let P = bls.gen_public(s)
		let domain = 0
		let str = "hello"
		let msg = `${str}${domain}`
		let sig = bls.sign(s, msg)
		assert(bls.verify(P, str, sig, domain), "did not verify aggregated signature")
	})

    it("should aggregate pubkeys ie. G1 members", async() => {
        let P1 = new mcl.G1()
        P1.setHashOf("noot1")
        let P2 = new mcl.G1()
        P2.setHashOf("noot2")
        let aggregated_pubkey = await bls.aggregate([P1, P2])
        assert(aggregated_pubkey instanceof mcl.G1)
    })

	it("should aggregate signatures ie. G2 members", async() => {
		let sig1 = new mcl.G2()
		sig1.setHashOf("noot1")
		let sig2 = new mcl.G2()
		sig2.setHashOf("noot2")
		let aggregated_sig = await bls.aggregate([sig1, sig2])
		assert(aggregated_sig instanceof mcl.G2)
	})

	it("should verify an aggregated signature of 1", async() => {
        let s = bls.gen_secret()
        let P = bls.gen_public(s)
		let domain = 0
		let str = "hello"
		let msg = `${str}${domain}`
		let sig = bls.sign(s, msg)
		assert(bls.verify_multiple([P], [str], sig, domain), "did not verify aggregated signature")
	})

	it("should verify an aggregated signature of 2", async() => {
        let s1 = bls.gen_secret()
        let P1 = bls.gen_public(s1)
        let s2 = bls.gen_secret()
        let P2 = bls.gen_public(s2)
		let domain = 0
		let str = "hello"
		let msg = `${str}${domain}`
		let sig1 = bls.sign(s1, msg)
		let sig2 = bls.sign(s2, msg)
		let aggregated_sig = await bls.aggregate([sig1, sig2])
		assert(bls.verify_multiple([P1, P2], [str, str], aggregated_sig, domain), "did not verify aggregated signature")
	})
})
