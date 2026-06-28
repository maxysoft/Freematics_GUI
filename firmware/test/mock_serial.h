// Mock Serial for host-side (native) tests. Buffers input/output.
#ifndef MOCK_SERIAL_H
#define MOCK_SERIAL_H

#include <string>
#include <queue>

class MockSerial {
public:
    std::string out;
    std::string in;
    size_t inPos = 0;

    void reset() {
        out.clear();
        in.clear();
        inPos = 0;
    }

    void feed(const std::string& s) {
        in += s;
    }

    int available() {
        return (int)(in.size() - inPos);
    }

    int read() {
        if (inPos >= in.size()) return -1;
        return (unsigned char)in[inPos++];
    }

    // Arduino String::readStringUntil reads until delim or timeout.
    std::string readStringUntil(char delim) {
        std::string r;
        while (inPos < in.size() && in[inPos] != delim) {
            r += in[inPos++];
        }
        if (inPos < in.size()) inPos++; // consume delim
        return r;
    }

    void print(const char* s) { out += s; }
    void print(const std::string& s) { out += s; }
    void print(char c) { out += c; }
    void println(const char* s = "") { out += s; out += "\r\n"; }
    void println(const std::string& s) { out += s; out += "\r\n"; }
};

extern MockSerial Serial;

#endif
