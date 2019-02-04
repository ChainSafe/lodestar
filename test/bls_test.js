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

	it("should hash message to G2", () => {
		let domain = 0
		let message = '0x6d657373616765'
		console.log(bls.hash_to_G2(message, domain))
	})

	it("should generate a secret key", () => {
        let s = bls.gen_secret()
        console.log(s.getStr(10))
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

        assert(public === Pstr, "incorrect deserialization")
        assert(Pstr.length === 98, "wrong length")
	})

	it("should get deserialize a hex string to a secret key and the corresponding public key", () => {
		let secret = '47b8192d77bf871b62e87859d653922725724a5c031afeabc60bcef5ff665138'
		let public = '0x1301803f8b5ac4a1133581fc676dfedc60d891dd5fa99028805e5ea5b08d3491af75d0707adab3b70c6a6a580217bf81'
		let s = new mcl.Fr()
        s.setStr(secret, 16)
        assert(s instanceof mcl.Fr)
        assert(s.getStr(16) === secret)

        let P = bls.gen_public(s)
        let Pstr = bls.getHexStr(P)
        assert(public === Pstr, "incorrect deserialization")
        assert(Pstr.length === 98, "wrong length")
	})

	it("should get deserialize a hex string to a secret key and the corresponding public key", () => {
		let secret = '328388aff0d4a5b7dc9205abd374e7e98f3cd9f3418edb4eafda5fb16473d216'
		let public = '0x153d21a4cfd562c469cc81514d4ce5a6b577d8403d32a394dc265dd190b47fa9f829fdd7963afdf972e5e77854051f6f'
		let s = new mcl.Fr()
        s.setStr(secret, 16)
        assert(s instanceof mcl.Fr)
        assert(s.getStr(16) === secret)

        let P = bls.gen_public(s)
        let Pstr = bls.getHexStr(P)
        assert(public === Pstr, "incorrect deserialization")
        assert(Pstr.length === 98, "wrong length")
	})

	it("should sign a message", () => {
		let secret = '263dbd792f5b1be47ed85f8938c0f29586af0d3ac7b977f21c278fe1462040e3'
		let s = new mcl.Fr()
        s.setStr(secret, 16)
        assert(s instanceof mcl.Fr)
        assert(s.getStr(16) === secret)

        let msg = "0x6d657373616765"
        let domain = 0
		let sig = bls.sign(s, msg, 0)
		assert(sig instanceof mcl.G2)
		console.log(sig.getStr(16))
	})

	it("should verify a signature", () => {
        let s = bls.gen_secret()
        let P = bls.gen_public(s)
		let domain = 0
		let msg = "hello"
		let sig = bls.sign(s, msg, domain)
		assert(bls.verify(P, msg, sig, domain), "did not verify aggregated signature")
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
		let msg = "hello"
		let sig = bls.sign(s, msg, domain)
		assert(bls.verify_multiple([P], [msg], sig, domain), "did not verify aggregated signature")
	})

	it("should verify an aggregated signature of 2", () => {
        let s1 = bls.gen_secret()
        let P1 = bls.gen_public(s1)
        let s2 = bls.gen_secret()
        let P2 = bls.gen_public(s2)
		let domain = 0
		let msg = "hello"
		let sig1 = bls.sign(s1, msg, domain)
		let sig2 = bls.sign(s2, msg, domain)
		let aggregated_sig = bls.aggregate([sig1, sig2])
		assert(bls.verify_multiple([P1, P2], [msg, msg], aggregated_sig, domain), "did not verify aggregated signature")
	})
})
