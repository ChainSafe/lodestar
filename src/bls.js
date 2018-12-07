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
    G = ctx.ECP.generator()
    return scalar_mult(G, k)
}

const add = (P1, P2) => {
    ctx.ECP.copy(P1)
    ctx.ECP.add(P2)
    return {x: ctx.ECP.getX, y: ctx.ECP.getY}
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

// perform S = S_1 + ... + S_n where n is the number of signatures to aggregate
// return (S, P_1 ... P_n, m_1 ... m_n)
const bls_aggregate = (S_arr, P_arr, m_arr) => {

}


module.exports = {gen_key_pair, scalar_mult, scalar_base_mult, add}