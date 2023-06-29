#ifndef BLST_TS_ADDON_H__
#define BLST_TS_ADDON_H__

#include <openssl/rand.h>

#include <iostream>
#include <memory>
#include <sstream>
#include <string>
#include <string_view>

#include "blst.hpp"
#include "napi.h"

// TODO: these should come out post PR review
using std::cout;
using std::endl;

#define BLST_TS_RANDOM_BYTES_LENGTH 8U

#define BLST_TS_FUNCTION_PREAMBLE                                              \
    Napi::Env env = info.Env();                                                \
    Napi::EscapableHandleScope scope(env);                                     \
    BlstTsAddon *module = env.GetInstanceData<BlstTsAddon>();

#define BLST_TS_UNWRAP_UINT_8_ARRAY(value_name, arr_name, js_name, ret_val)    \
    if (!value_name.IsTypedArray()) {                                          \
        Napi::TypeError::New(env, js_name " must be a BlstBuffer")             \
            .ThrowAsJavaScriptException();                                     \
        return ret_val;                                                        \
    }                                                                          \
    Napi::TypedArray arr_name##_array = value_name.As<Napi::TypedArray>();     \
    if (arr_name##_array.TypedArrayType() != napi_uint8_array) {               \
        Napi::TypeError::New(env, js_name " must be a BlstBuffer")             \
            .ThrowAsJavaScriptException();                                     \
        return ret_val;                                                        \
    }                                                                          \
    Napi::Uint8Array arr_name =                                                \
        arr_name##_array.As<Napi::TypedArrayOf<uint8_t>>();

#define BLST_TS_CREATE_UNWRAPPED_OBJECT(obj_name, class_name, instance_name)   \
    /* Allocate object in javascript heap */                                   \
    Napi::Object wrapped = module->_##obj_name##_ctr.New(                      \
        {Napi::External<void>::New(env, nullptr)});                            \
    /* Setup object correctly.  Start with type tagging wrapper class. */      \
    wrapped.TypeTag(&module->_##obj_name##_tag);                               \
    /* Unwrap object to get native instance */                                 \
    class_name *instance_name = class_name::Unwrap(wrapped);

#define BLST_TS_SERIALIZE_POINT(macro_name, class_name)                        \
    Napi::Env env = info.Env();                                                \
    Napi::EscapableHandleScope scope(env);                                     \
                                                                               \
    bool compressed{true};                                                     \
    if (!info[0].IsUndefined()) {                                              \
        compressed = info[0].ToBoolean().Value();                              \
    }                                                                          \
    Napi::Buffer<uint8_t> serialized = Napi::Buffer<uint8_t>::New(             \
        env,                                                                   \
        compressed ? BLST_TS_##macro_name##_LENGTH_COMPRESSED                  \
                   : BLST_TS_##macro_name##_LENGTH_UNCOMPRESSED);              \
                                                                               \
    if (_has_jacobian) {                                                       \
        compressed ? _jacobian->compress(serialized.Data())                    \
                   : _jacobian->serialize(serialized.Data());                  \
    } else if (_has_affine) {                                                  \
        compressed ? _affine->compress(serialized.Data())                      \
                   : _affine->serialize(serialized.Data());                    \
    } else {                                                                   \
        Napi::Error::New(                                                      \
            env, class_name " cannot be serialized. No point found!")          \
            .ThrowAsJavaScriptException();                                     \
        return scope.Escape(env.Undefined());                                  \
    }                                                                          \
                                                                               \
    return scope.Escape(serialized);

class BlstTsAddon;

typedef enum { Affine, Jacobian } CoordType;

/**
 * Checks a byte array to see if it is all zeros. Can pass start byte for the
 * cases where the first byte is the tag (infinity point and
 * compress/uncompressed).
 *
 * @param data uint8_t*
 * @param start_byte size_t
 * @param byte_length size_t
 *
 * @return bool
 */
bool is_zero_bytes(
    const uint8_t *data, const size_t start_byte, const size_t byte_length);

/**
 * Checks if a byte array is a valid length. If not, sets the error message and
 * returns false.  If valid returns true for use in conditional statements.
 *
 * @param[out] error_out &std::string - error message to set if invalid
 * @param[in] byte_length size_t - length of the byte array to validate
 * @param[in] length1 size_t - first valid length
 * @param[in] length2 size_t - second valid length (optional)
 *
 * @return bool
 */
bool is_valid_length(
    std::string &error_out,
    size_t byte_length,
    size_t length1,
    size_t length2 = 0);

/**
 * Circular dependency if these are moved up to the top of the file.
 */
#include "public_key.h"
#include "secret_key.h"
#include "signature.h"

/**
 * BlstTsAddon is the main entry point for the library. It is responsible
 * for initialization and holding global values.
 */
class BlstTsAddon : public Napi::Addon<BlstTsAddon> {
   public:
    std::string _dst;
    std::string _blst_error_strings[8];
    Napi::FunctionReference _secret_key_ctr;
    napi_type_tag _secret_key_tag;
    Napi::FunctionReference _public_key_ctr;
    napi_type_tag _public_key_tag;
    Napi::FunctionReference _signature_ctr;
    napi_type_tag _signature_tag;

    /**
     * BlstTsAddon::BlstTsAddon constructor used by Node.js to create an
     * instance of the addon.
     *
     * @param env Napi::Env
     * @param exports Napi::Object
     *
     * @return BlstTsAddon
     *
     * @throws Napi::Error
     */
    BlstTsAddon(Napi::Env env, Napi::Object exports);

    /**
     * References are by default non-copyable and non-movable. This is just
     * to make it explicit that it's not allowed to be copied or moved.
     */
    BlstTsAddon(BlstTsAddon &&source) = delete;
    BlstTsAddon(const BlstTsAddon &source) = delete;
    BlstTsAddon &operator=(BlstTsAddon &&source) = delete;
    BlstTsAddon &operator=(const BlstTsAddon &source) = delete;

    /**
     * Converts a blst error to an error string
     */
    std::string GetBlstErrorString(const blst::BLST_ERROR &err);

    /**
     * Uses the same openssl method as node to generate random bytes
     */
    bool GetRandomBytes(blst::byte *ikm, size_t length);
};

namespace Functions {
void Init(const Napi::Env &env, Napi::Object &exports);
}

#endif /* BLST_TS_ADDON_H__ */