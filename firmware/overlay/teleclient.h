#include "config.h"

#define EVENT_LOGIN 1
#define EVENT_LOGOUT 2
#define EVENT_SYNC 3
#define EVENT_RECONNECT 4
#define EVENT_COMMAND 5
#define EVENT_ACK 6
#define EVENT_PING 7

#define BUFFER_STATE_EMPTY 0
#define BUFFER_STATE_FILLING 1
#define BUFFER_STATE_FILLED 2
#define BUFFER_STATE_LOCKED 3

#define ELEMENT_UINT8 0
#define ELEMENT_UINT16 1
#define ELEMENT_UINT32 2
#define ELEMENT_INT32 3
#define ELEMENT_FLOAT 4
#define ELEMENT_FLOAT_D1 5 /* floating-point data with 1 decimal place*/
#define ELEMENT_FLOAT_D2 6 /* floating-point data with 2 decimal places*/

typedef struct {
    uint16_t pid;
    uint8_t type;
    uint8_t count;
} ELEMENT_HEAD;

class CBuffer
{
public:
    CBuffer(uint8_t* mem);
    void add(uint16_t pid, uint8_t type, void* values, int bytes, uint8_t count = 1);
    void purge();
    void serialize(CStorage& store);
    uint32_t timestamp;
    uint16_t offset;
    uint8_t total;
    uint8_t state;
private:
    uint8_t* m_data;
};

class CBufferManager
{
public:
    void init();
    void purge();
    void free(CBuffer* slot);
    CBuffer* getFree();
    CBuffer* getOldest();
    CBuffer* getNewest();
    void printStats();
private:
    CBuffer** slots = 0;
    CBuffer* last = 0;
    uint32_t total = 0;
};

// FCM patch: the base class gained the full virtual surface the sketch uses so
// the protocol (UDP vs HTTPS) can be selected AT RUNTIME through a TeleClient*.
// Upstream pitfalls fixed here:
//  - base connect() had a different signature than the derived
//    connect(bool quick) — the derived versions HID it instead of overriding,
//    so a base-pointer call would silently hit the "return true" stub.
//  - ping()/shutdown() existed only on the derived classes.
//  - the cell/wifi members have per-protocol types (CellUDP vs CellHTTP);
//    cellClient()/wifiClient() expose them through their common bases
//    (CellSIMCOM / ClientWIFI), which declare every method the sketch calls.
class TeleClient
{
public:
    virtual void reset()
    {
        txCount = 0;
        txBytes = 0;
        rxBytes = 0;
        login = false;
        startTime = millis();
    }
    virtual bool notify(byte event, const char* payload = 0) { return true; }
    virtual bool connect(bool quick = false) { return true; }
    virtual bool transmit(const char* packetBuffer, unsigned int packetSize)  { return true; }
    virtual void inbound() {}
    virtual bool ping() { return true; }
    virtual void shutdown() {}
    virtual CellSIMCOM* cellClient() = 0;
#if ENABLE_WIFI
    virtual ClientWIFI* wifiClient() = 0;
#endif
    virtual ~TeleClient() {}
    uint32_t txCount = 0;
    uint32_t txBytes = 0;
    uint32_t rxBytes = 0;
    uint32_t lastSyncTime = 0;
    uint16_t feedid = 0;
    uint32_t startTime = 0;
    uint8_t packets = 0;
    bool login = false;
};

class TeleClientUDP : public TeleClient
{
public:
    bool notify(byte event, const char* payload = 0) override;
    bool connect(bool quick = false) override;
    bool transmit(const char* packetBuffer, unsigned int packetSize) override;
    bool ping() override;
    void inbound() override;
    bool verifyChecksum(char* data);
    void shutdown() override;
    CellSIMCOM* cellClient() override { return &cell; }
#if ENABLE_WIFI
    ClientWIFI* wifiClient() override { return &wifi; }
    WifiUDP wifi;
#endif
    CellUDP cell;
};

class TeleClientHTTP : public TeleClient
{
public:
    bool notify(byte event, const char* payload = 0) override;
    bool connect(bool quick = false) override;
    bool transmit(const char* packetBuffer, unsigned int packetSize) override;
    bool ping() override;
    void shutdown() override;
    CellSIMCOM* cellClient() override { return &cell; }
#if ENABLE_WIFI
    ClientWIFI* wifiClient() override { return &wifi; }
    WifiHTTP wifi;
#endif
    CellHTTP cell;
};