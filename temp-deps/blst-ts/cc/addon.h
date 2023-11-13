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

#define BLST_TS_FUNCTION_PREAMBLE(info, env, module)                           \
    Napi::Env env = info.Env();                                                \
    Napi::EscapableHandleScope scope(env);                                     \
    BlstTsAddon *module = env.GetInstanceData<BlstTsAddon>();

#define BLST_TS_UNWRAP_UINT_8_ARRAY(value_name, arr_name, js_name, ret_val)    \
    if (!value_name.IsTypedArray()) {                                          \
        Napi::TypeError::New(                                                  \
            env, "BLST_ERROR: " js_name " must be a BlstBuffer")               \
            .ThrowAsJavaScriptException();                                     \
        return ret_val;                                                        \
    }                                                                          \
    Napi::TypedArray arr_name##_array = value_name.As<Napi::TypedArray>();     \
    if (arr_name##_array.TypedArrayType() != napi_uint8_array) {               \
        Napi::TypeError::New(                                                  \
            env, "BLST_ERROR: " js_name " must be a BlstBuffer")               \
            .ThrowAsJavaScriptException();                                     \
        return ret_val;                                                        \
    }                                                                          \
    Napi::Uint8Array arr_name =                                                \
        arr_name##_array.As<Napi::TypedArrayOf<uint8_t>>();

#define BLST_TS_CREATE_JHEAP_OBJECT(                                           \
    wrapped_name, obj_name, class_name, instance_name)                         \
    /* Allocate object in javascript heap */                                   \
    Napi::Object wrapped_name = module->_##obj_name##_ctr.New(                 \
        {Napi::External<void>::New(env, nullptr)});                            \
    /* Setup object correctly.  Start with type tagging wrapper class. */      \
    wrapped_name.TypeTag(&module->_##obj_name##_tag);                          \
    /* Unwrap object to get native instance */                                 \
    class_name *instance_name = class_name::Unwrap(wrapped_name);

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
            env,                                                               \
            "BLST_ERROR: " class_name                                          \
            " cannot be serialized. No point found!")                          \
            .ThrowAsJavaScriptException();                                     \
        return scope.Escape(env.Undefined());                                  \
    }                                                                          \
                                                                               \
    return scope.Escape(serialized);

#define BLST_TS_UNWRAP_POINT_ARG(                                              \
    env,                                                                       \
    module,                                                                    \
    val_name,                                                                  \
    ptr_group,                                                                 \
    has_error,                                                                 \
    snake_case_name,                                                           \
    pascal_case_name,                                                          \
    capital_case_name,                                                         \
    pascal_case_string,                                                        \
    blst_point,                                                                \
    group_num,                                                                 \
    coord_type,                                                                \
    member_name)                                                               \
    /* Arg is a serialized point */                                            \
    if (val_name.IsTypedArray()) {                                             \
        Napi::TypedArray untyped = val_name.As<Napi::TypedArray>();            \
        if (untyped.TypedArrayType() != napi_uint8_array) {                    \
            Napi::TypeError::New(                                              \
                env,                                                           \
                "BLST_ERROR: " pascal_case_string "Arg must be a BlstBuffer")  \
                .ThrowAsJavaScriptException();                                 \
            has_error = true;                                                  \
        }                                                                      \
        Napi::Uint8Array typed = untyped.As<Napi::Uint8Array>();               \
        std::string err_out{"BLST_ERROR: " pascal_case_string "Arg"};          \
        if (!is_valid_length(                                                  \
                err_out,                                                       \
                typed.ByteLength(),                                            \
                BLST_TS_##capital_case_name##_LENGTH_COMPRESSED,               \
                BLST_TS_##capital_case_name##_LENGTH_UNCOMPRESSED)) {          \
            Napi::TypeError::New(env, err_out).ThrowAsJavaScriptException();   \
            has_error = true;                                                  \
        }                                                                      \
        if (pascal_case_string[0] == 'P' &&                                    \
            is_zero_bytes(typed.Data(), 0, typed.ByteLength())) {              \
            Napi::TypeError::New(                                              \
                env, "BLST_ERROR: PublicKeyArg must not be zero key")          \
                .ThrowAsJavaScriptException();                                 \
            has_error = true;                                                  \
        }                                                                      \
        /** this can potentially throw. macro must be in try/catch. Leave in   \
         *  outer context so that loop counter can be used in error message    \
         *                                                                     \
         *  Only need to create this ptr to hold the blst::point and make sure \
         *  its deleted. Deserialized objects have a member smart pointer      \
         */                                                                    \
        ptr_group.unique_ptr.reset(                                            \
            new blst_point{typed.Data(), typed.ByteLength()});                 \
        ptr_group.raw_pointer = ptr_group.unique_ptr.get();                    \
                                                                               \
        /* Arg is a deserialized point */                                      \
    } else if (val_name.IsObject()) {                                          \
        Napi::Object wrapped = val_name.As<Napi::Object>();                    \
        if (!wrapped.CheckTypeTag(&module->_##snake_case_name##_tag)) {        \
            Napi::TypeError::New(                                              \
                env,                                                           \
                "BLST_ERROR: " pascal_case_string                              \
                " must be a " pascal_case_string "Arg")                        \
                .ThrowAsJavaScriptException();                                 \
            has_error = true;                                                  \
        }                                                                      \
        pascal_case_name *snake_case_name = pascal_case_name::Unwrap(wrapped); \
        /* Check that the required point type has been created */              \
        if (coord_type == CoordType::Jacobian) {                               \
            if (!snake_case_name->_has_jacobian) {                             \
                if (!snake_case_name->_has_affine) {                           \
                    Napi::Error::New(                                          \
                        env,                                                   \
                        "BLST_ERROR: " pascal_case_string " not initialized")  \
                        .ThrowAsJavaScriptException();                         \
                    has_error = true;                                          \
                }                                                              \
                snake_case_name->_jacobian.reset(new blst::P##group_num{       \
                    snake_case_name->_affine->to_jacobian()});                 \
                snake_case_name->_has_jacobian = true;                         \
            }                                                                  \
        } else {                                                               \
            if (!snake_case_name->_has_affine) {                               \
                if (!snake_case_name->_has_jacobian) {                         \
                    Napi::Error::New(                                          \
                        env,                                                   \
                        "BLST_ERROR: " pascal_case_string " not initialized")  \
                        .ThrowAsJavaScriptException();                         \
                    has_error = true;                                          \
                }                                                              \
                snake_case_name->_affine.reset(                                \
                    new blst::P##group_num##_Affine{                           \
                        snake_case_name->_jacobian->to_affine()});             \
                snake_case_name->_has_affine = true;                           \
            }                                                                  \
        }                                                                      \
        /* copy raw_pointer to context outside of macro */                     \
        ptr_group.raw_pointer = snake_case_name->member_name.get();            \
    } else {                                                                   \
        Napi::TypeError::New(                                                  \
            env,                                                               \
            "BLST_ERROR: " pascal_case_string " must be a " pascal_case_string \
            "Arg")                                                             \
            .ThrowAsJavaScriptException();                                     \
        has_error = true;                                                      \
    }

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
#include "functions.h"
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
     *
     * Either succeeds with exactly |length| bytes of cryptographically
     * strong pseudo-random data, or fails. This function may block.
     * Don't assume anything about the contents of |buffer| on error.
     * MUST check the return value for success!
     *
     * As a special case, |length == 0| can be used to check if the
     * GetRandomBytes is properly seeded without consuming entropy.
     */
    bool GetRandomBytes(blst::byte *ikm, size_t length);
};

#endif /* BLST_TS_ADDON_H__ */
