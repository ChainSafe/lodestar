#ifndef BLST_TS_FUNCTIONS_H__
#define BLST_TS_FUNCTIONS_H__

#include "addon.h"
#include "blst.hpp"
#include "napi.h"

/**
 * @note The unique_ptr is used to hold the blst::P* object if a Uint8Array is
 *       being converted instead of a PublicKey or Signature object.
 */
template <typename T>
struct PointerGroup {
    std::unique_ptr<T> unique_ptr = std::make_unique<T>();
    T *raw_pointer = nullptr;
};

namespace Functions {
void Init(const Napi::Env &env, Napi::Object &exports);
}

#endif /* BLST_TS_FUNCTIONS_H__ */
