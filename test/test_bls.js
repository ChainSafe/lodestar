const bls = require("../src/bls.js")
const CTX = require("milagro-crypto-js")
const ctx = new CTX("BLS381")
const assert = require("chai").assert

describe("bls", () => {
	it("should generate a key pair", () => {
		let salt = []

		keys = bls.gen_key_pair("noot", 10)
		console.log(`pubkey: ${keys.P.toString('hex')}`)
		console.log(`privkey: ${keys.k.toString('hex')}`)
		assert(ctx.ECDH.PUBLIC_KEY_VALIDATE(keys.P) == 0)
	})

	it("should perform scalar multiplation", () => {
		keys = bls.gen_key_pair("noot", 10)
		Z = bls.scalar_mult(keys.P, keys.k)
		console.log(`result: ${Z}`)
	})

	it("should add two points", () => {
		G = ctx.ECP.generator()
		Z = bls.add(G, G)
		console.log(`result: ${Z}`)
	})
})
