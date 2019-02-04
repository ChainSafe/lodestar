const bls = require("../")
const mcl = require("mcl-wasm")
const assert = require("chai").assert

describe("bls", () => {
	before(async() => {
		await mcl.init(mcl.BLS12_381)
	})

	it("should create base point for G1", () => {
        let q = bls.Q()
        assert(!q.isZero(), "did not create G1 base point")
	})

	it("should generate a secret key", () => {
        let s = bls.gen_secret()
        assert(s instanceof mcl.Fr && !s.isZero())
	})

	it("should get the corresponding public key to a secret key", () => {
        let s = bls.gen_secret()
        let P = bls.gen_public(s)
        assert(s instanceof mcl.Fr)
        assert(P instanceof mcl.G1)
	})

	it("should turn a G1 point to a public key hex string", () => {
	    let s = bls.gen_secret()
        let P = bls.gen_public(s)	
		let pubstr = bls.getHexStr(P)
		assert(pubstr.length === 98, "wrong length")
	})

	it("should get deserialize a hex string to a secret key and the corresponding public key", () => {
		let secret = '263dbd792f5b1be47ed85f8938c0f29586af0d3ac7b977f21c278fe1462040e3'
		let public = '0x0491d1b0ecd9bb917989f0e74f0dea0422eac4a873e5e2644f368dffb9a6e20fd6e10c1b77654d067c0618f6e5a7f79a'
		let s = new mcl.Fr()
        s.setStr(secret, 16)
        assert(s instanceof mcl.Fr)
        assert(s.getStr(16) === secret)

        let P = bls.gen_public(s)
        let Pstr = bls.getHexStr(P)
        assert(public == Pstr, "incorrect deserialization")
        assert(public.length === 98, "wrong length")
	})

	it("should get deserialize a hex string to a secret key and the corresponding public key", () => {
		let secret = '47b8192d77bf871b62e87859d653922725724a5c031afeabc60bcef5ff665138'
		let public = '0x1301803f8b5ac4a1133581fc676dfedc60d891dd5fa99028805e5ea5b08d3491af75d0707adab3b70c6a6a580217bf81'
		let s = new mcl.Fr()
        s.setStr(secret, 16)
        assert(s instanceof mcl.Fr)
        assert(s.getStr(16) === secret)
        let P = bls.gen_public(s)
        // console.log(P.getStr(16))
        // console.log(public)
        assert(public.slice(2) === P.getStr(16).slice(2, 98), "incorrect deserialization")
        assert(public.length === 98, "wrong length")
	})

	it("should sign a message", () => {
        let s = bls.gen_secret()
        let P = bls.gen_public(s)
        let msg = "noot"
		let sig = bls.sign(s, msg)
		assert(sig instanceof mcl.G2)
	})

	it("should verify a signature", () => {
        let s = bls.gen_secret()
        let P = bls.gen_public(s)
		let domain = 0
		let str = "hello"
		let msg = `${str}${domain}`
		let sig = bls.sign(s, msg)
		assert(bls.verify(P, str, sig, domain), "did not verify aggregated signature")
	})

    it("should aggregate pubkeys ie. G1 members", () => {
        let P1 = new mcl.G1()
        P1.setHashOf("noot1")
        let P2 = new mcl.G1()
        P2.setHashOf("noot2")
        let aggregated_pubkey = bls.aggregate([P1, P2])
        assert(aggregated_pubkey instanceof mcl.G1)
    })

	it("should aggregate signatures ie. G2 members", () => {
		let sig1 = new mcl.G2()
		sig1.setHashOf("noot1")
		let sig2 = new mcl.G2()
		sig2.setHashOf("noot2")
		let aggregated_sig = bls.aggregate([sig1, sig2])
		assert(aggregated_sig instanceof mcl.G2)
	})

	it("should verify an aggregated signature of 1", () => {
        let s = bls.gen_secret()
        let P = bls.gen_public(s)
		let domain = 0
		let str = "hello"
		let msg = `${str}${domain}`
		let sig = bls.sign(s, msg)
		assert(bls.verify_multiple([P], [str], sig, domain), "did not verify aggregated signature")
	})

	it("should verify an aggregated signature of 2", () => {
        let s1 = bls.gen_secret()
        let P1 = bls.gen_public(s1)
        let s2 = bls.gen_secret()
        let P2 = bls.gen_public(s2)
		let domain = 0
		let str = "hello"
		let msg = `${str}${domain}`
		let sig1 = bls.sign(s1, msg)
		let sig2 = bls.sign(s2, msg)
		let aggregated_sig = bls.aggregate([sig1, sig2])
		assert(bls.verify_multiple([P1, P2], [str, str], aggregated_sig, domain), "did not verify aggregated signature")
	})
})
