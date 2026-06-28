// Mock NVS for host-side (native) tests. Backs a std::map keyed by "ns/key".
#ifndef MOCK_NVS_H
#define MOCK_NVS_H

#include <string>
#include <unordered_map>
#include <cstring>

inline std::string nvs_key(const char* ns, const char* key) {
    return std::string(ns) + "/" + std::string(key);
}

inline std::unordered_map<std::string, std::string>& mock_nvs_str_store() {
    static std::unordered_map<std::string, std::string> s;
    return s;
}

inline std::unordered_map<std::string, int16_t>& mock_nvs_i16_store() {
    static std::unordered_map<std::string, int16_t> s;
    return s;
}

inline std::unordered_map<std::string, uint8_t>& mock_nvs_u8_store() {
    static std::unordered_map<std::string, uint8_t> s;
    return s;
}

inline void mock_nvs_reset() {
    mock_nvs_str_store().clear();
    mock_nvs_i16_store().clear();
    mock_nvs_u8_store().clear();
}

inline const char* mock_nvs_get_str(const char* ns, const char* key, const char* def) {
    auto& s = mock_nvs_str_store();
    auto it = s.find(nvs_key(ns, key));
    if (it == s.end()) return def;
    return it->second.c_str();
}

inline void mock_nvs_set_str(const char* ns, const char* key, const char* val) {
    mock_nvs_str_store()[nvs_key(ns, key)] = val;
}

inline uint8_t mock_nvs_get_u8(const char* ns, const char* key, uint8_t def) {
    auto& s = mock_nvs_u8_store();
    auto it = s.find(nvs_key(ns, key));
    return it == s.end() ? def : it->second;
}

inline void mock_nvs_set_u8(const char* ns, const char* key, uint8_t val) {
    mock_nvs_u8_store()[nvs_key(ns, key)] = val;
}

inline int16_t mock_nvs_get_i16(const char* ns, const char* key, int16_t def) {
    auto& s = mock_nvs_i16_store();
    auto it = s.find(nvs_key(ns, key));
    return it == s.end() ? def : it->second;
}

inline void mock_nvs_set_i16(const char* ns, const char* key, int16_t val) {
    mock_nvs_i16_store()[nvs_key(ns, key)] = val;
}

inline void mock_nvs_commit(const char* /*ns*/) {}

#endif
