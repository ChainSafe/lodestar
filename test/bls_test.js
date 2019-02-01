const bls = require("../")
const mcl = require("mcl-wasm")
const mcl_bls = require("bls-wasm")
const assert = require("chai").assert

describe("bls", () => {
	beforeEach(async() => {
		await mcl.init(mcl.BLS12_381)
	})

	it("should create base point for G1", async() => {
        let curve = await mcl.init(mcl.BLS12_381)
        let q = bls.Q()
        assert(!q.isZero(), "did not create G1 base point")
	})

	it("should generate a secret key", async() => {
		await mcl.init(mcl.BLS12_381)
        let s = bls.gen_secret()
        console.log(s)
        assert(s instanceof mcl.Fr)
	})

    it("should aggregate pubkeys ie. G1 members", async() => {
        let curve = await mcl.init(mcl.BLS12_381)
        let P1 = new mcl.G1()
        P1.setHashOf("noot1")
        let P2 = new mcl.G1()
        P2.setHashOf("noot2")
        let aggregated_pubkey = await bls.aggregate([P1, P2])
        assert(aggregated_pubkey instanceof mcl.G1)
    })

	it("should aggregate signatures ie. G2 members", async() => {
		let curve = await mcl.init(mcl.BLS12_381)
		let P1 = new mcl.G2()
		P1.setHashOf("noot1")
		let P2 = new mcl.G2()
		P2.setHashOf("noot2")
		let aggregated_sig = await bls.aggregate([P1, P2])
		assert(aggregated_sig instanceof mcl.G2)
	})

	it("should verify a signature", async() => {
		let curve = await mcl_bls.init(bls.BLS12_381)
		let sec = new mcl_bls.SecretKey()
		sec.setByCSPRNG()
		let pub = sec.getPublicKey()
		let domain = 0
		let str = "hello"
		let msg = `${str}${domain}`
		let sig = sec.sign(msg)
		assert(bls.verify(pub, str, sig, domain), "did not verify signature")
	})

	it("should verify an aggregated signature", async() => {
		let curve = await mcl.init(mcl.BLS12_381)
        // let P1 = new mcl.G1()
        // P1.setHashOf("noot1")

        let s = bls.gen_secret()
        let P = bls.gen_public(s)
		let domain = 0
		let str = "hello"
		let msg = `${str}${domain}`
		let sig = bls.sign(s, msg)
		assert(bls.verify_multiple([P], [str], sig, domain), "did not verify aggregated signature")
	})

})

