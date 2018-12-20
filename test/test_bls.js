const bls = require("../src/bls.js")
const CTX = require("../milagro-crypto-js")
const ctx = new CTX("BLS381")
const assert = require("chai").assert

describe("bls", () => {
	it("should generate a random number", () => {
		let x = bls.get_rand(128)
		console.log(x)
		assert(x.length == 256)
	})

	it("should generate another random number", () => {
		let x = bls.get_rand(128)
		console.log(x)
		assert(x.length == 256)
	})

	it("should generate a key pair", () => {
		keys = bls.gen_key_pair("noot", bls.get_rand(128))
		console.log(`pubkey: ${keys.P.toString('hex')}`)
		console.log(`privkey: ${keys.k.toString('hex')}`)
		assert(ctx.ECDH.PUBLIC_KEY_VALIDATE(keys.P) == 0)
	})

	it("should generate two different key pairs", () => {
		keys0 = bls.gen_key_pair("noot", bls.get_rand(128))
		assert(ctx.ECDH.PUBLIC_KEY_VALIDATE(keys0.P) == 0)

		keys1 = bls.gen_key_pair("noot", bls.get_rand(128))
		assert(ctx.ECDH.PUBLIC_KEY_VALIDATE(keys1.P) == 0)
		assert(keys1.k !== keys0.k)
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

	it("should hash a string", () => {
		let s = bls.hash_string("noot")
		console.log(s.toString('hex'))
		assert(s.toString('hex') == "2d7e9bbeb19cc0fc08cf4305c126dbf1f2952c63fb5006de5c2f25292a44ff2b")
	})
})
