// Copyright Supranational LLC
// Licensed under the Apache License, Version 2.0, see LICENSE for details.
// SPDX-License-Identifier: Apache-2.0

#ifndef __BLST_T_HPP__
#define __BLST_T_HPP__

/*
 * These templates, blst_384_t and blst_256_t, allow to instantiate slim
 * C++ shims to blst assembly with arbitrary moduli. Well, not literally
 * arbitrary, as there are limitations. Most notably blst_384_t can not
 * actually accommodate 384-bit moduli, only 383 and narrower. This is
 * because of ct_inverse_mod_383's limitation. Though if you abstain
 * from the reciprocal() method, even 384-bit modulus would work. As for
 * blst_256_t, modulus has to be not larger than 2^256-2^192-1.
 */

#ifdef __GNUC__
# pragma GCC diagnostic push
# pragma GCC diagnostic ignored "-Wunused-function"
#endif

extern "C" {
#include "vect.h"
}

#ifndef NDEBUG
# include "bytes.h"
#endif

#ifdef __GNUC__
# pragma GCC diagnostic pop
#endif

static inline void vec_left_align(limb_t *out, const limb_t *inp, size_t n)
{
    const unsigned int nbits = sizeof(inp[0])*8;
    unsigned int align = 0;
    limb_t top = inp[n-1];

    if (top) {
        while ((top >> (nbits-1)) == 0)
            top <<= 1, align++;
    }
    if (align) {
        while (--n) {
            limb_t next = inp[n-1];
            out[n] = top | next >> (nbits-align);
            top = next << align;
        }
        out[0] = top;
    } else {
        for (size_t i = 0; i < n-1; i++)
             out[i] = inp[i];
        out[n-1] = top;
    }
}

constexpr static inline size_t vec_nbits(const limb_t *inp, size_t n)
{
    const unsigned int nbits = sizeof(inp[0])*8;
    size_t align = 0;
    limb_t top = inp[n-1];

    while ((top >> (nbits-1)) == 0)
        top <<= 1, align++;

    return n*nbits - align;
}

template<const vec384 MOD, const limb_t M0, const vec384 RR, const vec384 ONE>
class blst_384_t {
private:
    vec384 val;

    inline operator const limb_t*() const           { return val;    }
    inline operator limb_t*()                       { return val;    }
    inline limb_t& operator[](size_t i)             { return val[i]; }
    inline const limb_t& operator[](size_t i) const { return val[i]; }

public:
    static const size_t nbits = vec_nbits(MOD, sizeof(vec384)/sizeof(limb_t));
    typedef byte pow_t[384/8];

    inline blst_384_t() {}
    inline blst_384_t(const vec384 p, bool align = false)
    {
        if (align)
            vec_left_align(val, p, sizeof(val)/sizeof(val[0]));
        else
            vec_copy(val, p, sizeof(val));
    }

    inline void to_scalar(pow_t& scalar) const
    {
        const union {
            long one;
            char little;
        } is_endian = { 1 };

        if ((size_t)scalar%sizeof(limb_t) == 0 && is_endian.little) {
            from_mont_384((limb_t *)scalar, val, MOD, M0);
        } else {
            vec384 out;
            from_mont_384(out, val, MOD, M0);
            le_bytes_from_limbs(scalar, out, sizeof(pow_t));
            vec_zero(out, sizeof(out));
        }
    }

    static inline const blst_384_t& one()
    {   return *reinterpret_cast<const blst_384_t*>(ONE);   }

    inline blst_384_t& to()
    {   mul_mont_384(val, RR, val, MOD, M0);        return *this;   }
    inline blst_384_t& from()
    {   from_mont_384(val, val, MOD, M0);           return *this;   }

    inline void store(limb_t *p) const
    {   vec_copy(p, val, sizeof(val));   }

    inline blst_384_t& operator+=(const blst_384_t& b)
    {   add_mod_384(val, val, b, MOD);              return *this;   }
    friend inline blst_384_t operator+(const blst_384_t& a, const blst_384_t& b)
    {
        blst_384_t ret;
        add_mod_384(ret, a, b, MOD);
        return ret;
    }

    inline blst_384_t& operator<<=(unsigned l)
    {   lshift_mod_384(val, val, l, MOD);           return *this;   }
    friend inline blst_384_t operator<<(const blst_384_t& a, unsigned l)
    {
        blst_384_t ret;
        lshift_mod_384(ret, a, l, MOD);
        return ret;
    }

    inline blst_384_t& operator>>=(unsigned r)
    {   rshift_mod_384(val, val, r, MOD);           return *this;   }
    friend inline blst_384_t operator>>(blst_384_t a, unsigned r)
    {
        blst_384_t ret;
        rshift_mod_384(ret, a, r, MOD);
        return ret;
    }

    inline blst_384_t& operator-=(const blst_384_t& b)
    {   sub_mod_384(val, val, b, MOD);              return *this;   }
    friend inline blst_384_t operator-(const blst_384_t& a, const blst_384_t& b)
    {
        blst_384_t ret;
        sub_mod_384(ret, a, b, MOD);
        return ret;
    }

    inline blst_384_t& cneg(bool flag)
    {   cneg_mod_384(val, val, flag, MOD);          return *this;   }
    friend inline blst_384_t cneg(const blst_384_t& a, bool flag)
    {
        blst_384_t ret;
        cneg_mod_384(ret, a, flag, MOD);
        return ret;
    }
    friend inline blst_384_t operator-(const blst_384_t& a)
    {
        blst_384_t ret;
        cneg_mod_384(ret, a, true, MOD);
        return ret;
    }

    inline blst_384_t& operator*=(const blst_384_t& a)
    {
        if (this == &a) sqr_mont_384(val, val, MOD, M0);
        else            mul_mont_384(val, val, a, MOD, M0);
        return *this;
    }
    friend inline blst_384_t operator*(const blst_384_t& a, const blst_384_t& b)
    {
        blst_384_t ret;
        if (&a == &b)   sqr_mont_384(ret, a, MOD, M0);
        else            mul_mont_384(ret, a, b, MOD, M0);
        return ret;
    }

    // simplified exponentiation, but mind the ^ operator's precedence!
    friend inline blst_384_t operator^(const blst_384_t& a, unsigned p)
    {
        if (p < 2) {
            abort();
        } else if (p == 2) {
            blst_384_t ret;
            sqr_mont_384(ret, a, MOD, M0);
            return ret;
        } else {
            blst_384_t ret;
            sqr_mont_384(ret, a, MOD, M0);
            for (p -= 2; p--;)
                mul_mont_384(ret, ret, a, MOD, M0);
            return ret;
        }
    }
    inline blst_384_t& operator^=(unsigned p)
    {
        if (p < 2) {
            abort();
        } else if (p == 2) {
            sqr_mont_384(val, val, MOD, M0);
            return *this;
        }
        return *this = *this^p;
    }
    inline blst_384_t operator()(unsigned p)
    {   return *this^p;   }
    friend inline blst_384_t sqr(const blst_384_t& a)
    {   return a^2;   }

    inline bool is_zero() const
    {   return vec_is_zero(val, sizeof(val));   }

    inline void zero()
    {   vec_zero(val, sizeof(val));   }

    blst_384_t reciprocal() const
    {
        static const blst_384_t MODx{MOD, true};
        static const blst_384_t RRx4 = *reinterpret_cast<const blst_384_t*>(RR)<<2;
        union { vec768 x; vec384 r[2]; } temp;

        ct_inverse_mod_383(temp.x, val, MOD, MODx);
        redc_mont_384(temp.r[0], temp.x, MOD, M0);
        mul_mont_384(temp.r[0], temp.r[0], RRx4, MOD, M0);

        return *reinterpret_cast<blst_384_t*>(temp.r[0]);
    }
    friend inline blst_384_t operator/(unsigned one, const blst_384_t& a)
    {
        if (one == 1)
            return a.reciprocal();
        abort();
    }
    friend inline blst_384_t operator/(const blst_384_t& a, const blst_384_t& b)
    {   return a * b.reciprocal();   }
    inline blst_384_t& operator/=(const blst_384_t& a)
    {   return *this *= a.reciprocal();   }

#ifndef NDEBUG
    inline blst_384_t(const char *hexascii)
    {   limbs_from_hexascii(val, sizeof(val), hexascii); to();   }

    friend inline bool operator==(const blst_384_t& a, const blst_384_t& b)
    {   return vec_is_equal(a, b, sizeof(vec384));   }
    friend inline bool operator!=(const blst_384_t& a, const blst_384_t& b)
    {   return !vec_is_equal(a, b, sizeof(vec384));   }

# if defined(_GLIBCXX_IOSTREAM) || defined(_IOSTREAM_) // non-standard
    friend std::ostream& operator<<(std::ostream& os, const blst_384_t& obj)
    {
        unsigned char be[sizeof(obj)];
        char buf[2+2*sizeof(obj)+1], *str = buf;

        be_bytes_from_limbs(be, blst_384_t{obj}.from(), sizeof(obj));

        *str++ = '0', *str++ = 'x';
        for (size_t i = 0; i < sizeof(obj); i++)
            *str++ = hex_from_nibble(be[i]>>4), *str++ = hex_from_nibble(be[i]);
	*str = '\0';

        return os << buf;
    }
# endif
#endif
};

template<const vec256 MOD, const limb_t M0, const vec256 RR, const vec256 ONE>
class blst_256_t {
    vec256 val;

    inline operator const limb_t*() const           { return val;    }
    inline operator limb_t*()                       { return val;    }
    inline limb_t& operator[](size_t i)             { return val[i]; }
    inline const limb_t& operator[](size_t i) const { return val[i]; }

public:
    static const size_t nbits = vec_nbits(MOD, sizeof(vec256)/sizeof(limb_t));
    typedef byte pow_t[256/8];

    inline blst_256_t() {}
    inline blst_256_t(const vec256 p, bool align = false)
    {
        if (align)
            vec_left_align(val, p, sizeof(val)/sizeof(val[0]));
        else
            vec_copy(val, p, sizeof(val));
    }

    inline void to_scalar(pow_t& scalar) const
    {
        const union {
            long one;
            char little;
        } is_endian = { 1 };

        if ((size_t)scalar%sizeof(limb_t) == 0 && is_endian.little) {
            from_mont_256((limb_t *)scalar, val, MOD, M0);
        } else {
            vec256 out;
            from_mont_256(out, val, MOD, M0);
            le_bytes_from_limbs(scalar, out, sizeof(pow_t));
            vec_zero(out, sizeof(out));
        }
    }

    static inline const blst_256_t& one()
    {   return *reinterpret_cast<const blst_256_t*>(ONE);   }

    inline blst_256_t& to()
    {   mul_mont_sparse_256(val, val, RR, MOD, M0); return *this;   }
    inline blst_256_t& from()
    {   from_mont_256(val, val, MOD, M0); return *this;   }

    inline void store(limb_t *p) const
    {   vec_copy(p, val, sizeof(val));   }

    inline blst_256_t& operator+=(const blst_256_t& b)
    {   add_mod_256(val, val, b, MOD);              return *this;   }
    friend inline blst_256_t operator+(const blst_256_t& a, const blst_256_t& b)
    {
        blst_256_t ret;
        add_mod_256(ret, a, b, MOD);
        return ret;
    }

    inline blst_256_t& operator<<=(unsigned l)
    {   lshift_mod_256(val, val, l, MOD);           return *this;   }
    friend inline blst_256_t operator<<(const blst_256_t& a, unsigned l)
    {
        blst_256_t ret;
        lshift_mod_256(ret, a, l, MOD);
        return ret;
    }

    inline blst_256_t& operator>>=(unsigned r)
    {   lshift_mod_256(val, val, r, MOD);           return *this;   }
    friend inline blst_256_t operator>>(blst_256_t a, unsigned r)
    {
        blst_256_t ret;
        lshift_mod_256(ret, a, r, MOD);
        return ret;
    }

    inline blst_256_t& operator-=(const blst_256_t& b)
    {   sub_mod_256(val, val, b, MOD);              return *this;   }
    friend inline blst_256_t operator-(const blst_256_t& a, const blst_256_t& b)
    {
        blst_256_t ret;
        sub_mod_256(ret, a, b, MOD);
        return ret;
    }

    inline blst_256_t& cneg(bool flag)
    {   cneg_mod_256(val, val, flag, MOD);          return *this;   }
    friend inline blst_256_t cneg(const blst_256_t& a, bool flag)
    {
        blst_256_t ret;
        cneg_mod_256(ret, a, flag, MOD);
        return ret;
    }
    friend inline blst_256_t operator-(const blst_256_t& a)
    {
        blst_256_t ret;
        cneg_mod_256(ret, a, true, MOD);
        return ret;
    }

    inline blst_256_t& operator*=(const blst_256_t& a)
    {
        if (this == &a) sqr_mont_sparse_256(val, val, MOD, M0);
        else            mul_mont_sparse_256(val, val, a, MOD, M0);
        return *this;
    }
    friend inline blst_256_t operator*(const blst_256_t& a, const blst_256_t& b)
    {
        blst_256_t ret;
        if (&a == &b)   sqr_mont_sparse_256(ret, a, MOD, M0);
        else            mul_mont_sparse_256(ret, a, b, MOD, M0);
        return ret;
    }

    // simplified exponentiation, but mind the ^ operator's precedence!
    friend inline blst_256_t operator^(const blst_256_t& a, unsigned p)
    {
        if (p < 2) {
            abort();
        } else if (p == 2) {
            blst_256_t ret;
            sqr_mont_sparse_256(ret, a, MOD, M0);
            return ret;
        } else {
            blst_256_t ret;
            sqr_mont_sparse_256(ret, a, MOD, M0);
            for (p -= 2; p--;)
                mul_mont_sparse_256(ret, ret, a, MOD, M0);
            return ret;
        }
    }
    inline blst_256_t& operator^=(unsigned p)
    {
        if (p < 2) {
            abort();
        } else if (p == 2) {
            sqr_mont_sparse_256(val, val, MOD, M0);
            return *this;
        }
        return *this = *this^p;
    }
    inline blst_256_t operator()(unsigned p)
    {   return *this^p;   }
    friend inline blst_256_t sqr(const blst_256_t& a)
    {   return a^2;   }

    inline bool is_zero() const
    {   return vec_is_zero(val, sizeof(val));   }

    inline void zero()
    {   vec_zero(val, sizeof(val));   }

    blst_256_t reciprocal() const
    {
        static const blst_256_t MODx{MOD, true};
        union { vec512 x; vec256 r[2]; } temp;

        ct_inverse_mod_256(temp.x, val, MOD, MODx);
        redc_mont_256(temp.r[0], temp.x, MOD, M0);
        mul_mont_sparse_256(temp.r[0], temp.r[0], RR, MOD, M0);

        return *reinterpret_cast<blst_256_t*>(temp.r[0]);
    }
    friend inline blst_256_t operator/(int one, const blst_256_t& a)
    {
        if (one == 1)
            return a.reciprocal();
        abort();
    }
    friend inline blst_256_t operator/(const blst_256_t& a, const blst_256_t& b)
    {   return a * b.reciprocal();   }
    inline blst_256_t& operator/=(const blst_256_t& a)
    {   return *this *= a.reciprocal();   }

#ifndef NDEBUG
    inline blst_256_t(const char *hexascii)
    {   limbs_from_hexascii(val, sizeof(val), hexascii); to();   }

    friend inline bool operator==(const blst_256_t& a, const blst_256_t& b)
    {   return vec_is_equal(a, b, sizeof(vec256));   }
    friend inline bool operator!=(const blst_256_t& a, const blst_256_t& b)
    {   return !vec_is_equal(a, b, sizeof(vec256));   }

# if defined(_GLIBCXX_IOSTREAM) || defined(_IOSTREAM_) // non-standard
    friend std::ostream& operator<<(std::ostream& os, const blst_256_t& obj)
    {
        unsigned char be[sizeof(obj)];
        char buf[2+2*sizeof(obj)+1], *str=buf;

        be_bytes_from_limbs(be, blst_256_t{obj}.from(), sizeof(obj));

        *str++ = '0', *str++ = 'x';
        for (size_t i = 0; i < sizeof(obj); i++)
            *str++ = hex_from_nibble(be[i]>>4), *str++ = hex_from_nibble(be[i]);
	*str = '\0';

        return os << buf;
    }
# endif
#endif
};
#endif
