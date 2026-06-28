// Minimal Arduino.h shim for native (host) builds.
// Provides String, uint*_t types, and F() macro enough for configstore/serial_handler.
#ifndef ARDUINO_H
#define ARDUINO_H

#include <cstdint>
#include <cstdlib>
#include <string>
#include <cstdio>
#include <cstring>

class String {
public:
    String() {}
    String(const char* s) : s_(s ? s : "") {}
    String(const std::string& s) : s_(s) {}
    String(char c) : s_(1, c) {}
    String(int v) { char b[16]; snprintf(b, sizeof(b), "%d", v); s_ = b; }
    String(unsigned int v) { char b[16]; snprintf(b, sizeof(b), "%u", v); s_ = b; }
    String(long v) { char b[16]; snprintf(b, sizeof(b), "%ld", v); s_ = b; }
    String(unsigned long v) { char b[16]; snprintf(b, sizeof(b), "%lu", v); s_ = b; }
    String(float v, int dec = 2) {
        char b[32]; snprintf(b, sizeof(b), "%.*f", dec, v); s_ = b;
    }

    const char* c_str() const { return s_.c_str(); }
    size_t length() const { return s_.size(); }
    bool isEmpty() const { return s_.empty(); }
    void trim() {
        size_t a = s_.find_first_not_of(" \t\r\n");
        if (a == std::string::npos) { s_.clear(); return; }
        size_t b = s_.find_last_not_of(" \t\r\n");
        s_ = s_.substr(a, b - a + 1);
    }
    void toLowerCase() {
        for (auto& c : s_) c = (char)tolower((unsigned char)c);
    }
    void toUpperCase() {
        for (auto& c : s_) c = (char)toupper((unsigned char)c);
    }
    bool endsWith(const String& suffix) const {
        if (suffix.length() > length()) return false;
        return s_.compare(s_.size() - suffix.length(), suffix.length(), suffix.s_) == 0;
    }
    bool startsWith(const String& prefix) const {
        if (prefix.length() > length()) return false;
        return s_.compare(0, prefix.length(), prefix.s_) == 0;
    }
    int indexOf(char c) const {
        size_t p = s_.find(c);
        return p == std::string::npos ? -1 : (int)p;
    }
    int indexOf(const String& sub) const {
        size_t p = s_.find(sub.s_);
        return p == std::string::npos ? -1 : (int)p;
    }
    String substring(int from) const {
        if (from < 0) from = 0;
        if ((size_t)from > s_.size()) from = s_.size();
        return String(s_.substr(from));
    }
    String substring(int from, int to) const {
        if (from < 0) from = 0;
        if (to < from) return String();
        if ((size_t)to > s_.size()) to = s_.size();
        return String(s_.substr(from, to - from));
    }
    void remove(int idx) {
        if (idx < 0 || (size_t)idx >= s_.size()) return;
        s_.erase(idx);
    }
    void remove(int idx, int count) {
        if (idx < 0 || (size_t)idx >= s_.size()) return;
        s_.erase(idx, count);
    }
    int toInt() const { return (int)strtol(s_.c_str(), nullptr, 10); }
    float toFloat() const { return strtof(s_.c_str(), nullptr); }

    String& operator=(const char* s) { s_ = s ? s : ""; return *this; }
    String& operator=(const std::string& s) { s_ = s; return *this; }
    String& operator+=(const char* s) { s_ += s ? s : ""; return *this; }
    String& operator+=(const String& s) { s_ += s.s_; return *this; }
    String& operator+=(char c) { s_ += c; return *this; }
    String operator+(const char* s) const { String r = *this; r += s; return r; }
    String operator+(const String& s) const { String r = *this; r += s; return r; }
    bool operator==(const char* s) const { return s_ == (s ? s : ""); }
    bool operator==(const String& s) const { return s_ == s.s_; }
    bool operator!=(const char* s) const { return !(*this == s); }
    bool operator!=(const String& s) const { return !(*this == s); }
    operator const char*() const { return s_.c_str(); }

private:
    std::string s_;
};

inline String operator+(const char* a, const String& b) {
    String r(a); r += b; return r;
}

#define F(x) String(x)

#endif
