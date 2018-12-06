const CTX = require("milagro-crypto-js")
const ctx = new CTX("BLS381")

// generate EC key pair (P, k) using pwd and salt
const gen_key_pair = (pwd, salt) => {
    let rng = new ctx.RAND()
    rng.clean()

    let k = []
    let P = []

    k = ctx.ECDH.PBKDF2(ctx.ECP.HASH_TYPE, pwd, salt, 1000, ctx.ECP.AESKEY)

    ctx.ECDH.KEY_PAIR_GENERATE(null, k, P)

    return {k, P}
}

// multiply point P by scalar k
// Z = P*k
const scalar_mult = (P, k) => {
    Z = []
    ctx.ECDH.ECPSVDP_DH(P, k, Z)
    return Z
}


// perform Z = k*G1
const scalar_base_mult = (k) => {

}

// perform H(m) = sha3(m)*G 
// not sure if this is the correct method to hash to curve
const hash_to_curve = (m) => {

}

// perform S = k*H(m) where S is the signature and H(m) is the hash of the message to
// the curve
const bls_sign = (k, m) => {

}

// perform e(P, H(m)) == e(G, S) where P is our public key, m is our message, S is 
// our signature, and G is the generator point
const bls_verify = (S, P, m) => {

}


module.exports = {gen_key_pair, scalar_mult}