/******************************************************************************
* Arduino sketch of a vehicle data data logger and telemeter for Freematics Hub
* Works with Freematics ONE+ Model A and Model B
* Developed by Stanley Huang <stanley@freematics.com.au>
* Distributed under BSD license
* Visit https://freematics.com/products for hardware information
* Visit https://hub.freematics.com to view live and history telemetry data
*
* THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
* IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
* FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
* AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
* LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
* OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
* THE SOFTWARE.
******************************************************************************/

#include <FreematicsPlus.h>
#include <httpd.h>
#include "config.h"
#include "telestore.h"
#include "teleclient.h"
#include "serial_handler.h"
#if BOARD_HAS_PSRAM
#include "esp32/himem.h"
#endif
#include "driver/adc.h"
#include "nvs_flash.h"
#include "nvs.h"
#if ENABLE_BLE
#include "esp_bt.h" // esp_bt_controller_mem_release when BLE runtime-disabled
#endif
#if ENABLE_OLED
#include "FreematicsOLED.h"
#endif

// ---------------------------------------------------------------------------
// Freematics Config Manager (FCM) patch: runtime configuration.
//
// The stock sketch fixes protocol/storage/GNSS/feature selection at compile
// time. This build compiles ALL features in and selects/tunes them at boot
// from the NVS-backed config store (managed over serial by the desktop app),
// so every device-permitted option is changeable without reflashing.
// Values below are the compile-time defaults; fcmApplyConfig() (end of file)
// overrides them from the stored config during setup().
// ---------------------------------------------------------------------------
Config cfg;
float fcmMotionThr = MOTION_THRESHOLD;
int   fcmMaxObdErr = MAX_OBD_ERRORS;
int   fcmGnssResetT = GNSS_RESET_TIMEOUT;
int   fcmPingbackInt = PING_BACK_INTERVAL;
int   fcmCoolingT = COOLING_DOWN_TEMP;
float fcmJumpstartV = JUMPSTART_VOLTAGE;
uint8_t fcmGnss = GNSS;                 // GNSS_NONE / GNSS_STANDALONE / GNSS_CELLULAR
uint8_t fcmStorage = STORAGE_NONE;      // STORAGE_NONE / STORAGE_SPIFFS / STORAGE_SD
uint8_t fcmProto = PROTOCOL_UDP;        // client selection: UDP vs HTTPS
bool fcmSrvMethodGet = false;           // HTTPS style: GET query vs POST body
bool fcmObd = true;
bool fcmMems = true;
bool fcmBle = false;
bool fcmHttpd = false;
bool fcmGnssAlways = false;
char fcmSrvHost[64] = SERVER_HOST;
uint16_t fcmSrvPort = SERVER_PORT;
char fcmSrvPath[64] = SERVER_PATH;
char fcmApSSID[32] = WIFI_AP_SSID;
char fcmApPwd[32] = WIFI_AP_PASSWORD;
// Boot-time snapshots of the cellular credentials. The telemetry task must
// NEVER read the cfg Strings directly: the loop task mutates them on CFG=
// (Arduino String = heap realloc), and an unsynchronized cross-task read is a
// use-after-free. Snapshots are plain char arrays written once in
// fcmApplyConfig() before the telemetry task starts.
char fcmSimPin[16] = SIM_CARD_PIN;
char fcmApnUser[32] = "";
char fcmApnPass[32] = "";
// Guards the netop/ip String globals, which the telemetry task reassigns and
// the loop task (serial live queries, BLE) reads concurrently.
SemaphoreHandle_t fcmLiveMux = 0;
void fcmApplyConfig(Config& c);
static void fcmSetNetop(const String& v);
static void fcmSetIp(const String& v);

// states
#define STATE_STORAGE_READY 0x1
#define STATE_OBD_READY 0x2
#define STATE_GPS_READY 0x4
#define STATE_MEMS_READY 0x8
#define STATE_NET_READY 0x10
#define STATE_GPS_ONLINE 0x20
#define STATE_CELL_CONNECTED 0x40
#define STATE_WIFI_CONNECTED 0x80
#define STATE_WORKING 0x100
#define STATE_STANDBY 0x200

typedef struct {
  byte pid;
  byte tier;
  int value;
  uint32_t ts;
} PID_POLLING_INFO;

PID_POLLING_INFO obdData[]= {
  {PID_SPEED, 1},
  {PID_RPM, 1},
  {PID_THROTTLE, 1},
  {PID_ENGINE_LOAD, 1},
  {PID_FUEL_PRESSURE, 2},
  {PID_TIMING_ADVANCE, 2},
  {PID_COOLANT_TEMP, 3},
  {PID_INTAKE_TEMP, 3},
};

CBufferManager bufman;
Task subtask;

#if ENABLE_MEMS
float accBias[3] = {0}; // calibrated reference accelerometer data
float accSum[3] = {0};
float acc[3] = {0};
float gyr[3] = {0};
float mag[3] = {0};
uint8_t accCount = 0;
#endif
int deviceTemp = 0;

// config data
char apn[32];
#if ENABLE_WIFI
char wifiSSID[32] = WIFI_SSID;
char wifiPassword[32] = WIFI_PASSWORD;
#endif
nvs_handle_t nvs;

// live data
String netop;
String ip;
int16_t rssi = 0;
int16_t rssiLast = 0;
char vin[18] = {0};
uint16_t dtc[6] = {0};
float batteryVoltage = 0;
GPS_DATA* gd = 0;

char devid[12] = {0};
char isoTime[32] = {0};

// stats data
uint32_t lastMotionTime = 0;
uint32_t timeoutsOBD = 0;
uint32_t timeoutsNet = 0;
uint32_t lastStatsTime = 0;

int32_t syncInterval = SERVER_SYNC_INTERVAL * 1000;
int32_t dataInterval = 1000;

// FCM patch: unconditional (storage backend is a runtime choice now); also
// referenced by dataserver.cpp handlers.
int fileid = 0;
uint16_t lastSizeKB = 0;

byte ledMode = 0;

bool serverSetup(IPAddress& ip);
void serverProcess(int timeout);
void processMEMS(CBuffer* buffer);
bool processGPS(CBuffer* buffer);
void processBLE(int timeout);

class State {
public:
  bool check(uint16_t flags) { return (m_state & flags) == flags; }
  void set(uint16_t flags) { m_state |= flags; }
  void clear(uint16_t flags) { m_state &= ~flags; }
  uint16_t m_state = 0;
};

FreematicsESP32 sys;

class OBD : public COBD
{
protected:
  void idleTasks()
  {
    // do some quick tasks while waiting for OBD response
#if ENABLE_MEMS
    processMEMS(0);
#endif
    processBLE(0);
  }
};

OBD obd;

MEMS_I2C* mems = 0;

// FCM patch: storage backend and protocol client are chosen at runtime from
// the stored config; instances are created once in setup() after cfg.load().
// logger stays null for STORAGE_NONE (guarded by STATE_STORAGE_READY + null
// checks); teleClient is always created (UDP by default).
FileLogger* logger = 0;
TeleClient* teleClient = 0;

#if ENABLE_OLED
OLED_SH1106 oled;
#endif

State state;

void printTimeoutStats()
{
  Serial.print("Timeouts: OBD:");
  Serial.print(timeoutsOBD);
  Serial.print(" Network:");
  Serial.println(timeoutsNet);
}

void beep(int duration)
{
    // turn on buzzer at 2000Hz frequency 
    sys.buzzer(2000);
    delay(duration);
    // turn off buzzer
    sys.buzzer(0);
}

#if LOG_EXT_SENSORS
void processExtInputs(CBuffer* buffer)
{
#if LOG_EXT_SENSORS == 1
  uint8_t levels[2] = {(uint8_t)digitalRead(PIN_SENSOR1), (uint8_t)digitalRead(PIN_SENSOR2)};
  buffer->add(PID_EXT_SENSORS, ELEMENT_UINT8, levels, sizeof(levels), 2);
#elif LOG_EXT_SENSORS == 2
  uint16_t reading[] = {adc1_get_raw(ADC1_CHANNEL_0), adc1_get_raw(ADC1_CHANNEL_1)};
  Serial.print("GPIO0:");
  Serial.print((float)reading[0] * 3.15 / 4095 - 0.01);
  Serial.print(" GPIO1:");
  Serial.println((float)reading[1] * 3.15 / 4095 - 0.01);
  buffer->add(PID_EXT_SENSORS, ELEMENT_UINT16, reading, sizeof(reading), 2);
#endif
}
#endif

/*******************************************************************************
  HTTP API
*******************************************************************************/
#if ENABLE_HTTPD
int handlerLiveData(UrlHandlerParam* param)
{
    char *buf = param->pucBuffer;
    int bufsize = param->bufSize;
    int n = snprintf(buf, bufsize, "{\"obd\":{\"vin\":\"%s\",\"battery\":%.1f,\"pid\":[", vin, batteryVoltage);
    uint32_t t = millis();
    for (int i = 0; i < sizeof(obdData) / sizeof(obdData[0]); i++) {
        n += snprintf(buf + n, bufsize - n, "{\"pid\":%u,\"value\":%d,\"age\":%u},",
            0x100 | obdData[i].pid, obdData[i].value, (unsigned int)(t - obdData[i].ts));
    }
    n--;
    n += snprintf(buf + n, bufsize - n, "]}");
#if ENABLE_MEMS
    if (accCount) {
      n += snprintf(buf + n, bufsize - n, ",\"mems\":{\"acc\":[%d,%d,%d],\"stationary\":%u}",
          (int)((accSum[0] / accCount - accBias[0]) * 100), (int)((accSum[1] / accCount - accBias[1]) * 100), (int)((accSum[2] / accCount - accBias[2]) * 100),
          (unsigned int)(millis() - lastMotionTime));
    }
#endif
    if (gd && gd->ts) {
      n += snprintf(buf + n, bufsize - n, ",\"gps\":{\"utc\":\"%s\",\"lat\":%f,\"lng\":%f,\"alt\":%f,\"speed\":%f,\"sat\":%d,\"age\":%u}",
          isoTime, gd->lat, gd->lng, gd->alt, gd->speed, (int)gd->sat, (unsigned int)(millis() - gd->ts));
    }
    buf[n++] = '}';
    param->contentLength = n;
    param->contentType=HTTPFILETYPE_JSON;
    return FLAG_DATA_RAW;
}
#endif

/*******************************************************************************
  Reading and processing OBD data
*******************************************************************************/
#if ENABLE_OBD
void processOBD(CBuffer* buffer)
{
  static int idx[2] = {0, 0};
  int tier = 1;
  for (byte i = 0; i < sizeof(obdData) / sizeof(obdData[0]); i++) {
    if (obdData[i].tier > tier) {
        // reset previous tier index
        idx[tier - 2] = 0;
        // keep new tier number
        tier = obdData[i].tier;
        // move up current tier index
        i += idx[tier - 2]++;
        // check if into next tier
        if (obdData[i].tier != tier) {
            idx[tier - 2]= 0;
            i--;
            continue;
        }
    }
    byte pid = obdData[i].pid;
    if (!obd.isValidPID(pid)) continue;
    int value;
    if (obd.readPID(pid, value)) {
        obdData[i].ts = millis();
        obdData[i].value = value;
        buffer->add((uint16_t)pid | 0x100, ELEMENT_INT32, &value, sizeof(value));
    } else {
        timeoutsOBD++;
        printTimeoutStats();
        break;
    }
    if (tier > 1) break;
  }
  int kph = obdData[0].value;
  if (kph >= 2) lastMotionTime = millis();
}
#endif

bool initGPS()
{
  // start GNSS receiver
  if (sys.gpsBeginExt()) {
    Serial.println("GNSS:OK(E)");
  } else if (sys.gpsBegin()) {
    Serial.println("GNSS:OK(I)");
  } else {
    Serial.println("GNSS:NO");
    return false;
  }
  return true;
}

bool processGPS(CBuffer* buffer)
{
  static uint32_t lastGPStime = 0;
  static float lastGPSLat = 0;
  static float lastGPSLng = 0;

  if (!gd) {
    lastGPStime = 0;
    lastGPSLat = 0;
    lastGPSLng = 0;
  }
  // FCM patch: GNSS source selected at runtime. NONE returns false instead of
  // falling into the cellular query (an upstream quirk).
  if (fcmGnss == GNSS_STANDALONE) {
    if (state.check(STATE_GPS_READY)) {
      // read parsed GPS data
      if (!sys.gpsGetData(&gd)) {
        return false;
      }
    }
  } else if (fcmGnss == GNSS_CELLULAR) {
    if (!teleClient->cellClient()->getLocation(&gd)) {
      return false;
    }
  } else {
    return false;
  }
  if (!gd || lastGPStime == gd->time) return false;
  if (gd->date) {
    // generate ISO time string
    char *p = isoTime + sprintf(isoTime, "%04u-%02u-%02uT%02u:%02u:%02u",
        (unsigned int)(gd->date % 100) + 2000, (unsigned int)(gd->date / 100) % 100, (unsigned int)(gd->date / 10000),
        (unsigned int)(gd->time / 1000000), (unsigned int)(gd->time % 1000000) / 10000, (unsigned int)(gd->time % 10000) / 100);
    unsigned char tenth = (gd->time % 100) / 10;
    if (tenth) p += sprintf(p, ".%c00", '0' + tenth);
    *p = 'Z';
    *(p + 1) = 0;
  }
  if (gd->lng == 0 && gd->lat == 0) {
    // coordinates not ready
    if (gd->date) {
      Serial.print("[GNSS] ");
      Serial.println(isoTime);
    }
    return false;
  }
  if ((lastGPSLat || lastGPSLng) && (abs(gd->lat - lastGPSLat) > 0.001 || abs(gd->lng - lastGPSLng) > 0.001)) {
    // invalid coordinates data
    lastGPSLat = 0;
    lastGPSLng = 0;
    return false;
  }
  lastGPSLat = gd->lat;
  lastGPSLng = gd->lng;

  float kph = gd->speed * 1.852f;
  if (kph >= 2) lastMotionTime = millis();

  if (buffer) {
    buffer->add(PID_GPS_TIME, ELEMENT_UINT32, &gd->time, sizeof(uint32_t));
    buffer->add(PID_GPS_LATITUDE, ELEMENT_FLOAT, &gd->lat, sizeof(float));
    buffer->add(PID_GPS_LONGITUDE, ELEMENT_FLOAT, &gd->lng, sizeof(float));
    buffer->add(PID_GPS_ALTITUDE, ELEMENT_FLOAT_D1, &gd->alt, sizeof(float)); /* m */
    buffer->add(PID_GPS_SPEED, ELEMENT_FLOAT_D1, &kph, sizeof(kph));
    buffer->add(PID_GPS_HEADING, ELEMENT_UINT16, &gd->heading, sizeof(uint16_t));
    if (gd->sat) buffer->add(PID_GPS_SAT_COUNT, ELEMENT_UINT8, &gd->sat, sizeof(uint8_t));
    if (gd->hdop) buffer->add(PID_GPS_HDOP, ELEMENT_UINT8, &gd->hdop, sizeof(uint8_t));
  }
  
  Serial.print("[GNSS] ");
  Serial.print(gd->lat, 6);
  Serial.print(' ');
  Serial.print(gd->lng, 6);
  Serial.print(' ');
  Serial.print((int)kph);
  Serial.print("km/h");
  Serial.print(" SATS:");
  Serial.print(gd->sat);
  Serial.print(" HDOP:");
  Serial.print(gd->hdop);
  Serial.print(" Course:");
  Serial.println(gd->heading);
  //Serial.println(gd->errors);
  lastGPStime = gd->time;
  return true;
}

bool waitMotionGPS(int timeout)
{
  unsigned long t = millis();
  lastMotionTime = 0;
  do {
      serverProcess(100);
    if (!processGPS(0)) continue;
    if (lastMotionTime) return true;
  } while (millis() - t < timeout);
  return false;
}

#if ENABLE_MEMS
void processMEMS(CBuffer* buffer)
{
  if (!state.check(STATE_MEMS_READY)) return;

  // load and store accelerometer data
  float temp;
#if ENABLE_ORIENTATION
  ORIENTATION ori;
  if (!mems->read(acc, gyr, mag, &temp, &ori)) return;
#else
  if (!mems->read(acc, gyr, mag, &temp)) return;
#endif
  deviceTemp = (int)temp;

  accSum[0] += acc[0];
  accSum[1] += acc[1];
  accSum[2] += acc[2];
  accCount++;

  if (buffer) {
    if (accCount) {
      float value[3];
      value[0] = accSum[0] / accCount - accBias[0];
      value[1] = accSum[1] / accCount - accBias[1];
      value[2] = accSum[2] / accCount - accBias[2];
      buffer->add(PID_ACC, ELEMENT_FLOAT_D2, value, sizeof(value), 3);
/*
      Serial.print("[ACC] ");
      Serial.print(value[0]);
      Serial.print('/');
      Serial.print(value[1]);
      Serial.print('/');
      Serial.println(value[2]);
*/
#if ENABLE_ORIENTATION
      value[0] = ori.yaw;
      value[1] = ori.pitch;
      value[2] = ori.roll;
      buffer->add(PID_ORIENTATION, ELEMENT_FLOAT_D2, value, sizeof(value), 3);
#endif
#if 0
      // calculate motion
      float motion = 0;
      for (byte i = 0; i < 3; i++) {
        motion += value[i] * value[i];
      }
      if (motion >= fcmMotionThr * fcmMotionThr) {
        lastMotionTime = millis();
        Serial.print("Motion:");
        Serial.println(motion);
      }
#endif
    }
    accSum[0] = 0;
    accSum[1] = 0;
    accSum[2] = 0;
    accCount = 0;
  }
}

void calibrateMEMS()
{
  if (state.check(STATE_MEMS_READY)) {
    accBias[0] = 0;
    accBias[1] = 0;
    accBias[2] = 0;
    int n;
    unsigned long t = millis();
    for (n = 0; millis() - t < 1000; n++) {
      float acc[3];
      if (!mems->read(acc)) continue;
      accBias[0] += acc[0];
      accBias[1] += acc[1];
      accBias[2] += acc[2];
      delay(10);
    }
    accBias[0] /= n;
    accBias[1] /= n;
    accBias[2] /= n;
    Serial.print("ACC BIAS:");
    Serial.print(accBias[0]);
    Serial.print('/');
    Serial.print(accBias[1]);
    Serial.print('/');
    Serial.println(accBias[2]);
  }
}
#endif

void printTime()
{
  time_t utc;
  time(&utc);
  struct tm *btm = gmtime(&utc);
  if (btm->tm_year > 100) {
    // valid system time available
    char buf[64];
    sprintf(buf, "%04u-%02u-%02u %02u:%02u:%02u",
      1900 + btm->tm_year, btm->tm_mon + 1, btm->tm_mday, btm->tm_hour, btm->tm_min, btm->tm_sec);
    Serial.print("UTC:");
    Serial.println(buf);
  }
}

/*******************************************************************************
  Initializing all data logging components
*******************************************************************************/
void initialize()
{
  // dump buffer data
  bufman.purge();

#if ENABLE_MEMS
  if (state.check(STATE_MEMS_READY)) {
    calibrateMEMS();
  }
#endif

  // FCM patch: standalone GPS init only when configured for it.
  if (fcmGnss == GNSS_STANDALONE && !state.check(STATE_GPS_READY)) {
    if (initGPS()) {
      state.set(STATE_GPS_READY);
    }
  }

#if ENABLE_OBD
  // initialize OBD communication (skipped when disabled at runtime — the
  // link probe is slow and pointless without a vehicle connection)
  if (fcmObd && !state.check(STATE_OBD_READY)) {
    timeoutsOBD = 0;
    if (obd.init()) {
      Serial.println("OBD:OK");
      state.set(STATE_OBD_READY);
#if ENABLE_OLED
      oled.println("OBD OK");
#endif
    } else {
      Serial.println("OBD:NO");
      //state.clear(STATE_WORKING);
      //return;
    }
  }
#endif

  // FCM patch: storage backend chosen at runtime; logger is null for NONE.
  if (logger && !state.check(STATE_STORAGE_READY)) {
    // init storage
    if (logger->init()) {
      state.set(STATE_STORAGE_READY);
    }
  }
  if (logger && state.check(STATE_STORAGE_READY)) {
    fileid = logger->begin();
  }

  // re-try OBD if connection not established
#if ENABLE_OBD
  if (state.check(STATE_OBD_READY)) {
    char buf[128];
    if (obd.getVIN(buf, sizeof(buf))) {
      memcpy(vin, buf, sizeof(vin) - 1);
      Serial.print("VIN:");
      Serial.println(vin);
    }
    int dtcCount = obd.readDTC(dtc, sizeof(dtc) / sizeof(dtc[0]));
    if (dtcCount > 0) {
      Serial.print("DTC:");
      Serial.println(dtcCount);
    }
#if ENABLE_OLED
    oled.print("VIN:");
    oled.println(vin);
#endif
  }
#endif

  // check system time
  printTime();

  lastMotionTime = millis();
  state.set(STATE_WORKING);

#if ENABLE_OLED
  delay(1000);
  oled.clear();
  oled.print("DEVICE ID: ");
  oled.println(devid);
  oled.setCursor(0, 7);
  oled.print("Packets");
  oled.setCursor(80, 7);
  oled.print("KB Sent");
  oled.setFontSize(FONT_SIZE_MEDIUM);
#endif
}

void showStats()
{
  uint32_t t = millis() - teleClient->startTime;
  char buf[32];
  sprintf(buf, "%02u:%02u.%c ", t / 60000, (t % 60000) / 1000, (t % 1000) / 100 + '0');
  Serial.print("[NET] ");
  Serial.print(buf);
  Serial.print("| Packet #");
  Serial.print(teleClient->txCount);
  Serial.print(" | Out: ");
  Serial.print(teleClient->txBytes >> 10);
  Serial.print(" KB | In: ");
  Serial.print(teleClient->rxBytes);
  Serial.print(" bytes | ");
  Serial.print((unsigned int)((uint64_t)(teleClient->txBytes + teleClient->rxBytes) * 3600 / (millis() - teleClient->startTime)));
  Serial.print(" KB/h");

  Serial.println();
#if ENABLE_OLED
  oled.setCursor(0, 2);
  oled.println(timestr);
  oled.setCursor(0, 5);
  oled.printInt(teleClient->txCount, 2);
  oled.setCursor(80, 5);
  oled.printInt(teleClient->txBytes >> 10, 3);
#endif
}

bool waitMotion(long timeout)
{
#if ENABLE_MEMS
  unsigned long t = millis();
  if (state.check(STATE_MEMS_READY)) {
    do {
      // calculate relative movement
      float motion = 0;
      float acc[3];
      if (!mems->read(acc)) continue;
      if (accCount == 10) {
        accCount = 0;
        accSum[0] = 0;
        accSum[1] = 0;
        accSum[2] = 0;
      }
      accSum[0] += acc[0];
      accSum[1] += acc[1];
      accSum[2] += acc[2];
      accCount++;
      for (byte i = 0; i < 3; i++) {
        float m = (acc[i] - accBias[i]);
        motion += m * m;
      }
#if ENABLE_HTTPD
      serverProcess(100);
#endif
      processBLE(100);
      // FCM patch: service the config serial link while waiting for motion so
      // a configurator connecting to a sleeping device wakes it instead of
      // needing a power-cycle.
      processSerial(cfg);
      if (fcmAwake()) return false;
      // check movement
      if (motion >= fcmMotionThr * fcmMotionThr) {
        //lastMotionTime = millis();
        Serial.println(motion);
        return true;
      }
    } while (state.check(STATE_STANDBY) && ((long)(millis() - t) < timeout || timeout == -1));
    return false;
  }
#endif
  serverProcess(timeout);
  return false;
}

/*******************************************************************************
  Collecting and processing data
*******************************************************************************/
void process()
{
  static uint32_t lastGPStick = 0;
  uint32_t startTime = millis();

  CBuffer* buffer = bufman.getFree();
  buffer->state = BUFFER_STATE_FILLING;

#if ENABLE_OBD
  // process OBD data if connected (FCM: runtime-gated — when disabled, skip
  // both the polling and the every-cycle ECU re-probe)
  if (fcmObd) {
    if (state.check(STATE_OBD_READY)) {
      processOBD(buffer);
      if (obd.errors >= fcmMaxObdErr) {
        if (!obd.init()) {
          Serial.println("[OBD] ECU OFF");
          state.clear(STATE_OBD_READY | STATE_WORKING);
          return;
        }
      }
    } else if (obd.init(PROTO_AUTO, true)) {
      state.set(STATE_OBD_READY);
      Serial.println("[OBD] ECU ON");
    }
  }
#endif

  if (rssi != rssiLast) {
    int val = (rssiLast = rssi);
    buffer->add(PID_CSQ, ELEMENT_INT32, &val, sizeof(val));
  }
#if ENABLE_OBD
  // FCM: battery voltage via ADC needs no OBD link; the obd.getVoltage() path
  // is a blocking link command, so gate it on the runtime OBD toggle.
  if (sys.devType > 12) {
    batteryVoltage = (float)(analogRead(A0) * 45) / 4095;
  } else if (fcmObd) {
    batteryVoltage = obd.getVoltage();
  }
  if (batteryVoltage) {
    uint16_t v = batteryVoltage * 100;
    buffer->add(PID_BATTERY_VOLTAGE, ELEMENT_UINT16, &v, sizeof(v));
  }
#endif

#if LOG_EXT_SENSORS
  processExtInputs(buffer);
#endif

#if ENABLE_MEMS
  processMEMS(buffer);
#endif

  bool success = processGPS(buffer);
  // FCM patch: no-fix GNSS reset watchdog at runtime; only meaningful for the
  // standalone receiver (upstream ran it in cellular builds too — a quirk).
  if (fcmGnssResetT > 0 && fcmGnss == GNSS_STANDALONE) {
    if (success) {
      lastGPStick = millis();
      state.set(STATE_GPS_ONLINE);
    } else {
      if (millis() - lastGPStick > (uint32_t)fcmGnssResetT * 1000) {
        sys.gpsEnd();
        state.clear(STATE_GPS_ONLINE | STATE_GPS_READY);
        delay(20);
        if (initGPS()) state.set(STATE_GPS_READY);
        lastGPStick = millis();
      }
    }
  }

  if (!state.check(STATE_MEMS_READY)) {
    deviceTemp = readChipTemperature();
  }
  buffer->add(PID_DEVICE_TEMP, ELEMENT_INT32, &deviceTemp, sizeof(deviceTemp));

  buffer->timestamp = millis();
  buffer->state = BUFFER_STATE_FILLED;

  // display file buffer stats
  if (startTime - lastStatsTime >= 3000) {
    bufman.printStats();
    lastStatsTime = startTime;
  }

  if (logger && state.check(STATE_STORAGE_READY)) {
    buffer->serialize(*logger);
    uint16_t sizeKB = (uint16_t)(logger->size() >> 10);
    if (sizeKB != lastSizeKB) {
      logger->flush();
      lastSizeKB = sizeKB;
      Serial.print("[FILE] ");
      Serial.print(sizeKB);
      Serial.println("KB");
    }
  }

  const int dataIntervals[] = DATA_INTERVAL_TABLE;
  // FCM patch: motion sources (OBD speed / MEMS) are runtime toggles now. With
  // neither USABLE, lastMotionTime never updates, so the adaptive control would
  // park the device — and standby() would then have no wake source and fall
  // into the restart branch, i.e. a perpetual reboot loop. MEMS counts as a
  // motion source only if its probe actually succeeded; otherwise keep running
  // at a fixed interval.
  if (fcmObd || (fcmMems && state.check(STATE_MEMS_READY))) {
  // motion adaptive data interval control
  const uint16_t stationaryTime[] = STATIONARY_TIME_TABLE;
  unsigned int motionless = (millis() - lastMotionTime) / 1000;
  bool stationary = true;
  for (byte i = 0; i < sizeof(stationaryTime) / sizeof(stationaryTime[0]); i++) {
    dataInterval = dataIntervals[i];
    if (motionless < stationaryTime[i] || stationaryTime[i] == 0) {
      stationary = false;
      break;
    }
  }
  if (stationary) {
    // stationery timeout
    Serial.print("Stationary for ");
    Serial.print(motionless);
    Serial.println(" secs");
    // trip ended, go into standby
    state.clear(STATE_WORKING);
    return;
  }
  } else {
  dataInterval = dataIntervals[0];
  }
  do {
    long t = dataInterval - (millis() - startTime);
    processBLE(t > 0 ? t : 0);
  } while (millis() - startTime < dataInterval);
}

bool initCell(bool quick = false)
{
  Serial.println("[CELL] Activating...");
  // power on network module
  if (!teleClient->cellClient()->begin(&sys)) {
    Serial.println("[CELL] No supported module");
#if ENABLE_OLED
    oled.println("No Cell Module");
#endif
    return false;
  }
  if (quick) return true;
#if ENABLE_OLED
    oled.print(teleClient->cellClient()->deviceName());
    oled.println(" OK\r");
    oled.print("IMEI:");
    oled.println(teleClient->cellClient()->IMEI);
#endif
  Serial.print("CELL:");
  Serial.println(teleClient->cellClient()->deviceName());
  // FCM patch: SIM PIN from the stored config (empty = no PIN).
  if (!teleClient->cellClient()->checkSIM(fcmSimPin[0] ? fcmSimPin : (const char*)0)) {
    Serial.println("NO SIM CARD");
    //return false;
  }
  Serial.print("IMEI:");
  Serial.println(teleClient->cellClient()->IMEI);
  Serial.println("[CELL] Searching...");
  if (*apn) {
    Serial.print("APN:");
    Serial.println(apn);
  }
  // FCM patch: APN auth from the stored config (empty = none).
  if (teleClient->cellClient()->setup(apn,
        fcmApnUser[0] ? fcmApnUser : (const char*)0,
        fcmApnPass[0] ? fcmApnPass : (const char*)0)) {
    fcmSetNetop(teleClient->cellClient()->getOperatorName());
    if (netop.length()) {
      Serial.print("Operator:");
      Serial.println(netop);
#if ENABLE_OLED
      oled.println(op);
#endif
    }

    if (fcmGnss == GNSS_CELLULAR) {
      if (teleClient->cellClient()->setGPS(true)) {
        Serial.println("CELL GNSS:OK");
      }
    }

    fcmSetIp(teleClient->cellClient()->getIP());
    if (ip.length()) {
      Serial.print("[CELL] IP:");
      Serial.println(ip);
#if ENABLE_OLED
      oled.print("IP:");
      oled.println(ip);
#endif
    }
    state.set(STATE_CELL_CONNECTED);
  } else {
    char *p = strstr(teleClient->cellClient()->getBuffer(), "+CPSI:");
    if (p) {
      char *q = strchr(p, '\r');
      if (q) *q = 0;
      Serial.print("[CELL] ");
      Serial.println(p + 7);
#if ENABLE_OLED
      oled.println(p + 7);
#endif
    } else {
      Serial.print(teleClient->cellClient()->getBuffer());
    }
  }
  timeoutsNet = 0;
  return state.check(STATE_CELL_CONNECTED);
}

/*******************************************************************************
  Initializing network, maintaining connection and doing transmissions
*******************************************************************************/
void telemetry(void* inst)
{
  uint32_t lastRssiTime = 0;
  uint8_t connErrors = 0;
  CStorageRAM store;
  store.init(
#if BOARD_HAS_PSRAM
    (char*)heap_caps_malloc(SERIALIZE_BUFFER_SIZE, MALLOC_CAP_SPIRAM),
#else
    (char*)malloc(SERIALIZE_BUFFER_SIZE),
#endif
    SERIALIZE_BUFFER_SIZE
  );
  teleClient->reset();

  for (;;) {
    if (state.check(STATE_STANDBY)) {
      if (state.check(STATE_CELL_CONNECTED) || state.check(STATE_WIFI_CONNECTED)) {
        teleClient->shutdown();
        fcmSetNetop("");
        fcmSetIp("");
        rssi = 0;
      }
      state.clear(STATE_NET_READY | STATE_CELL_CONNECTED | STATE_WIFI_CONNECTED);
      teleClient->reset();
      bufman.purge();

      uint32_t t = millis();
      do {
        delay(1000);
      // FCM patch: fcmPingbackInt <= 0 = ping-backs disabled (keep sleeping).
      } while (state.check(STATE_STANDBY) && (fcmPingbackInt <= 0 || millis() - t < 1000L * fcmPingbackInt));
      if (state.check(STATE_STANDBY)) {
        // start ping
#if ENABLE_WIFI
        if (wifiSSID[0]) { 
          Serial.print("[WIFI] Joining SSID:");
          Serial.println(wifiSSID);
          teleClient->wifiClient()->begin(wifiSSID, wifiPassword);
        }
        if (teleClient->wifiClient()->setup()) {
          Serial.println("[WIFI] Ping...");
          teleClient->ping();
        }
        else
#endif
        {
          if (initCell()) {
            Serial.println("[CELL] Ping...");
            teleClient->ping();
          }
        }
        teleClient->shutdown();
        state.clear(STATE_CELL_CONNECTED | STATE_WIFI_CONNECTED);
      }
      continue;
    }

#if ENABLE_WIFI
    if (wifiSSID[0] && !state.check(STATE_WIFI_CONNECTED)) {
      Serial.print("[WIFI] Joining SSID:");
      Serial.println(wifiSSID);
      teleClient->wifiClient()->begin(wifiSSID, wifiPassword);
      teleClient->wifiClient()->setup();
    }
#endif

    while (state.check(STATE_WORKING)) {
#if ENABLE_WIFI
      if (wifiSSID[0]) {
        if (!state.check(STATE_WIFI_CONNECTED) && teleClient->wifiClient()->connected()) {
          fcmSetIp(teleClient->wifiClient()->getIP());
          if (ip.length()) {
            Serial.print("[WIFI] IP:");
            Serial.println(ip);
          }
          connErrors = 0;
          if (teleClient->connect()) {
            state.set(STATE_WIFI_CONNECTED | STATE_NET_READY);
            beep(50);
            // switch off cellular module when wifi connected
            if (state.check(STATE_CELL_CONNECTED)) {
              teleClient->cellClient()->end();
              state.clear(STATE_CELL_CONNECTED);
              Serial.println("[CELL] Deactivated");
            }
          }
        } else if (state.check(STATE_WIFI_CONNECTED) && !teleClient->wifiClient()->connected()) {
          Serial.println("[WIFI] Disconnected");
          state.clear(STATE_WIFI_CONNECTED);
        }
      }
#endif
      if (!state.check(STATE_WIFI_CONNECTED) && !state.check(STATE_CELL_CONNECTED)) {
        connErrors = 0;
        if (!initCell() || !teleClient->connect()) {
          teleClient->cellClient()->end();
          state.clear(STATE_NET_READY | STATE_CELL_CONNECTED);
          Serial.println("[CELL] Deactivated");
          // avoid turning on/off cellular module too frequently to avoid operator banning
          delay(60000 * 3);
          break;
        }
        Serial.println("[CELL] In service");
        state.set(STATE_NET_READY);
        beep(50);
      }

      if (millis() - lastRssiTime > SIGNAL_CHECK_INTERVAL * 1000) {
#if ENABLE_WIFI
        if (state.check(STATE_WIFI_CONNECTED))
        {
          rssi = teleClient->wifiClient()->RSSI();
        }
        else
#endif
        {
          rssi = teleClient->cellClient()->RSSI();
        }
        if (rssi) {
          Serial.print("RSSI:");
          Serial.print(rssi);
          Serial.println("dBm");
        }
        lastRssiTime = millis();

#if ENABLE_WIFI
        if (wifiSSID[0] && !state.check(STATE_WIFI_CONNECTED)) {
          teleClient->wifiClient()->begin(wifiSSID, wifiPassword);
        }
#endif
      }

      // get data from buffer
      CBuffer* buffer = bufman.getNewest();
      if (!buffer) {
        delay(50);
        continue;
      }
      if (fcmProto == PROTOCOL_UDP) store.header(devid);
      store.timestamp(buffer->timestamp);
      buffer->serialize(store);
      bufman.free(buffer);
      store.tailer();
      Serial.print("[DAT] ");
      Serial.println(store.buffer());

      // start transmission
#ifdef PIN_LED
      if (ledMode == 0) digitalWrite(PIN_LED, HIGH);
#endif

      if (teleClient->transmit(store.buffer(), store.length())) {
        // successfully sent
        connErrors = 0;
        showStats();
      } else {
        timeoutsNet++;
        connErrors++;
        printTimeoutStats();
        if (connErrors < MAX_CONN_ERRORS_RECONNECT) {
          // quick reconnect
          teleClient->connect(true);
        }
      }
#ifdef PIN_LED
      if (ledMode == 0) digitalWrite(PIN_LED, LOW);
#endif
      store.purge();

      teleClient->inbound();

      if (state.check(STATE_CELL_CONNECTED) && !teleClient->cellClient()->check(1000)) {
        Serial.println("[CELL] Not in service");
        state.clear(STATE_NET_READY | STATE_CELL_CONNECTED);
        break;
      }

      if (syncInterval > 10000 && millis() - teleClient->lastSyncTime > syncInterval) {
        Serial.println("[NET] Poor connection");
        timeoutsNet++;
        if (!teleClient->connect()) {
          connErrors++;
        }
      }

      if (connErrors >= MAX_CONN_ERRORS_RECONNECT) {
#if ENABLE_WIFI
        if (state.check(STATE_WIFI_CONNECTED)) {
          teleClient->wifiClient()->end();
          state.clear(STATE_NET_READY | STATE_WIFI_CONNECTED);
          break;
        }
#endif
        if (state.check(STATE_CELL_CONNECTED)) {
          teleClient->cellClient()->end();
          state.clear(STATE_NET_READY | STATE_CELL_CONNECTED);
          break;
        }
      }

      if (deviceTemp >= fcmCoolingT) {
        // device too hot, cool down by pause transmission
        Serial.print("HIGH DEVICE TEMP: ");
        Serial.println(deviceTemp);
        bufman.purge();
      }

    }
  }
}

/*******************************************************************************
  Implementing stand-by mode
*******************************************************************************/
void standby()
{
  state.set(STATE_STANDBY);
  if (logger && state.check(STATE_STORAGE_READY)) {
    logger->end();
  }

  // FCM patch: runtime GNSS-always-on / GNSS mode.
  if (!fcmGnssAlways && fcmGnss == GNSS_STANDALONE && state.check(STATE_GPS_READY)) {
    Serial.println("[GNSS] OFF");
    sys.gpsEnd(true);
    state.clear(STATE_GPS_READY | STATE_GPS_ONLINE);
    gd = 0;
  }

  state.clear(STATE_WORKING | STATE_OBD_READY | STATE_STORAGE_READY);
  // this will put co-processor into sleep mode
#if ENABLE_OLED
  oled.print("STANDBY");
  delay(1000);
  oled.clear();
#endif
  Serial.println("STANDBY");
  obd.enterLowPowerMode();
  // FCM patch: wake strategy chosen at runtime. CRITICAL: waitMotion(-1) may
  // only run when the MEMS is actually up (runtime-enabled AND probed OK) —
  // otherwise it would fall through to serverProcess(-1) and sleep ~49 days.
  if (fcmMems && state.check(STATE_MEMS_READY)) {
    calibrateMEMS();
    waitMotion(-1);
  } else if (fcmObd) {
    do {
      delay(5000);
      // FCM patch: a serial command during the jumpstart wait wakes the device.
      processSerial(cfg);
      if (fcmAwake()) break;
    } while (obd.getVoltage() < fcmJumpstartV);
  } else {
    delay(5000);
    // FCM patch: this branch is reachable via cooling-down/BLE-OFF standby;
    // service the config link here too so a configurator can always connect.
    processSerial(cfg);
  }
  // FCM patch: a SERIAL wake means a configurator wants to talk — it must NOT
  // go through the motion-wake tail below (resetLink + RESET_AFTER_WAKEUP's
  // ESP.restart()), which would reboot the device the host just connected to
  // and turn periodic app polling into an endless reboot cycle. Return with
  // standby states intact; loop()'s keep-awake guard services serial until
  // the window lapses, then standby() runs again.
  if (fcmAwake()) {
    return;
  }
  Serial.println("WAKEUP");
  sys.resetLink();
#if RESET_AFTER_WAKEUP
#if ENABLE_MEMS
  if (mems) mems->end();  
#endif
  ESP.restart();
#endif  
  state.clear(STATE_STANDBY);
}

/*******************************************************************************
  Tasks to perform in idle/waiting time
*******************************************************************************/
void genDeviceID(char* buf)
{
    uint64_t seed = ESP.getEfuseMac() >> 8;
    for (int i = 0; i < 8; i++, seed >>= 5) {
      byte x = (byte)seed & 0x1f;
      if (x >= 10) {
        x = x - 10 + 'A';
        switch (x) {
          case 'B': x = 'W'; break;
          case 'D': x = 'X'; break;
          case 'I': x = 'Y'; break;
          case 'O': x = 'Z'; break;
        }
      } else {
        x += '0';
      }
      buf[i] = x;
    }
    buf[8] = 0;
}

void showSysInfo()
{
  Serial.print("CPU:");
  Serial.print(ESP.getCpuFreqMHz());
  Serial.print("MHz FLASH:");
  Serial.print(ESP.getFlashChipSize() >> 20);
  Serial.println("MB");
  Serial.print("IRAM:");
  Serial.print(ESP.getHeapSize() >> 10);
  Serial.print("KB");
#if BOARD_HAS_PSRAM
  if (psramInit()) {
    Serial.print(" PSRAM:");
    Serial.print(esp_spiram_get_size() >> 20);
    Serial.print("MB");
  }
#endif
  Serial.println();

  int rtc = rtc_clk_slow_freq_get();
  if (rtc) {
    Serial.print("RTC:");
    Serial.println(rtc);
  }

#if ENABLE_OLED
  oled.clear();
  oled.print("CPU:");
  oled.print(ESP.getCpuFreqMHz());
  oled.print("Mhz ");
  oled.print(getFlashSize() >> 10);
  oled.println("MB Flash");
#endif

  Serial.print("DEVICE ID:");
  Serial.println(devid);
#if ENABLE_OLED
  oled.print("DEVICE ID:");
  oled.println(devid);
#endif
}

void loadConfig()
{
  size_t len;
  len = sizeof(apn);
  apn[0] = 0;
  nvs_get_str(nvs, "CELL_APN", apn, &len);
  if (!apn[0]) {
    strcpy(apn, CELL_APN);
  }

#if ENABLE_WIFI
  len = sizeof(wifiSSID);
  nvs_get_str(nvs, "WIFI_SSID", wifiSSID, &len);
  len = sizeof(wifiPassword);
  nvs_get_str(nvs, "WIFI_PWD", wifiPassword, &len);
#endif
}

void processBLE(int timeout)
{
#if ENABLE_BLE
  // FCM patch: when BLE is disabled at runtime, behave exactly like the
  // ENABLE_BLE=0 stub (plain delay). Without this the call degrades to a
  // busy-spin (ble_recv_command returns immediately when never initialized)
  // and this function doubles as the main loop's pacing sleep.
  if (!fcmBle) {
    if (timeout > 0) delay(timeout);
    return;
  }
  static byte echo = 0;
  char* cmd;
  if (!(cmd = ble_recv_command(timeout))) {
    return;
  }

  char *p = strchr(cmd, '\r');
  if (p) *p = 0;
  char buf[48];
  int bufsize = sizeof(buf);
  int n = 0;
  if (echo) n += snprintf(buf + n, bufsize - n, "%s\r", cmd);
  Serial.print("[BLE] ");
  Serial.print(cmd);
  if (!strcmp(cmd, "UPTIME") || !strcmp(cmd, "TICK")) {
    n += snprintf(buf + n, bufsize - n, "%lu", millis());
  } else if (!strcmp(cmd, "BATT")) {
    n += snprintf(buf + n, bufsize - n, "%.2f", (float)(analogRead(A0) * 42) / 4095);
  } else if (!strcmp(cmd, "RESET")) {
    if (logger) logger->end();
    ESP.restart();
    // never reach here
  } else if (!strcmp(cmd, "OFF")) {
    state.set(STATE_STANDBY);
    state.clear(STATE_WORKING);
    n += snprintf(buf + n, bufsize - n, "OK");
  } else if (!strcmp(cmd, "ON")) {
    state.clear(STATE_STANDBY);
    n += snprintf(buf + n, bufsize - n, "OK");
  } else if (!strcmp(cmd, "ON?")) {
    n += snprintf(buf + n, bufsize - n, "%u", state.check(STATE_STANDBY) ? 0 : 1);
  } else if (!strcmp(cmd, "APN?")) {
    n += snprintf(buf + n, bufsize - n, "%s", *apn ? apn : "DEFAULT");
  } else if (!strncmp(cmd, "APN=", 4)) {
    n += snprintf(buf + n, bufsize - n, nvs_set_str(nvs, "CELL_APN", strcmp(cmd + 4, "DEFAULT") ? cmd + 4 : "") == ESP_OK ? "OK" : "ERR");
    loadConfig();
  } else if (!strcmp(cmd, "NET_OP")) {
    if (state.check(STATE_WIFI_CONNECTED)) {
#if ENABLE_WIFI
      n += snprintf(buf + n, bufsize - n, "%s", wifiSSID[0] ? wifiSSID : "-");
#endif
    } else {
      snprintf(buf + n, bufsize - n, "%s", netop.length() ? netop.c_str() : "-");
      char *p = strchr(buf + n, ' ');
      if (p) *p = 0;
      n += strlen(buf + n);
    }
  } else if (!strcmp(cmd, "NET_IP")) {
    n += snprintf(buf + n, bufsize - n, "%s", ip.length() ? ip.c_str() : "-");
  } else if (!strcmp(cmd, "NET_PACKET")) {
      n += snprintf(buf + n, bufsize - n, "%u", teleClient->txCount);
  } else if (!strcmp(cmd, "NET_DATA")) {
      n += snprintf(buf + n, bufsize - n, "%u", teleClient->txBytes);
  } else if (!strcmp(cmd, "NET_RATE")) {
      n += snprintf(buf + n, bufsize - n, "%u", teleClient->startTime ? (unsigned int)((uint64_t)(teleClient->txBytes + teleClient->rxBytes) * 3600 / (millis() - teleClient->startTime)) : 0);
  } else if (!strcmp(cmd, "RSSI")) {
    n += snprintf(buf + n, bufsize - n, "%d", rssi);
#if ENABLE_WIFI
  } else if (!strcmp(cmd, "SSID?")) {
    n += snprintf(buf + n, bufsize - n, "%s", wifiSSID[0] ? wifiSSID : "-");
  } else if (!strncmp(cmd, "SSID=", 5)) {
    const char* p = cmd + 5;
    n += snprintf(buf + n, bufsize - n, nvs_set_str(nvs, "WIFI_SSID", strcmp(p, "-") ? p : "") == ESP_OK ? "OK" : "ERR");
    loadConfig();
  } else if (!strcmp(cmd, "WPWD?")) {
    n += snprintf(buf + n, bufsize - n, "%s", wifiPassword[0] ? wifiPassword : "-");
  } else if (!strncmp(cmd, "WPWD=", 5)) {
    const char* p = cmd + 5;
    n += snprintf(buf + n, bufsize - n, nvs_set_str(nvs, "WIFI_PWD", strcmp(p, "-") ? p : "") == ESP_OK ? "OK" : "ERR");
    loadConfig();
#else
  } else if (!strcmp(cmd, "SSID?") || !strcmp(cmd, "WPWD?")) {
    n += snprintf(buf + n, bufsize - n, "-");
#endif
#if ENABLE_MEMS
  } else if (!strcmp(cmd, "TEMP")) {
    n += snprintf(buf + n, bufsize - n, "%d", (int)deviceTemp);
  } else if (!strcmp(cmd, "ACC")) {
    n += snprintf(buf + n, bufsize - n, "%.1f/%.1f/%.1f", acc[0], acc[1], acc[2]);
  } else if (!strcmp(cmd, "GYRO")) {
    n += snprintf(buf + n, bufsize - n, "%.1f/%.1f/%.1f", gyr[0], gyr[1], gyr[2]);
  } else if (!strcmp(cmd, "GF")) {
    n += snprintf(buf + n, bufsize - n, "%f", (float)sqrt(acc[0]*acc[0] + acc[1]*acc[1] + acc[2]*acc[2]));
#endif
  } else if (!strcmp(cmd, "ATE0")) {
    echo = 0;
    n += snprintf(buf + n, bufsize - n, "OK");
  } else if (!strcmp(cmd, "ATE1")) {
    echo = 1;
    n += snprintf(buf + n, bufsize - n, "OK");
  } else if (!strcmp(cmd, "FS")) {
    n += snprintf(buf + n, bufsize - n, "%u", logger ? logger->size() : 0);
  } else if (!memcmp(cmd, "01", 2)) {
    byte pid = hex2uint8(cmd + 2);
    for (byte i = 0; i < sizeof(obdData) / sizeof(obdData[0]); i++) {
      if (obdData[i].pid == pid) {
        n += snprintf(buf + n, bufsize - n, "%d", obdData[i].value);
        pid = 0;
        break;
      }
    }
    if (pid) {
      int value;
      if (obd.readPID(pid, value)) {
        n += snprintf(buf + n, bufsize - n, "%d", value);
      } else {
        n += snprintf(buf + n, bufsize - n, "N/A");
      }
    }
  } else if (!strcmp(cmd, "VIN")) {
    n += snprintf(buf + n, bufsize - n, "%s", vin[0] ? vin : "N/A");
  } else if (!strcmp(cmd, "LAT") && gd) {
    n += snprintf(buf + n, bufsize - n, "%f", gd->lat);
  } else if (!strcmp(cmd, "LNG") && gd) {
    n += snprintf(buf + n, bufsize - n, "%f", gd->lng);
  } else if (!strcmp(cmd, "ALT") && gd) {
    n += snprintf(buf + n, bufsize - n, "%d", (int)gd->alt);
  } else if (!strcmp(cmd, "SAT") && gd) {
    n += snprintf(buf + n, bufsize - n, "%u", (unsigned int)gd->sat);
  } else if (!strcmp(cmd, "SPD") && gd) {
    n += snprintf(buf + n, bufsize - n, "%d", (int)(gd->speed * 1852 / 1000));
  } else if (!strcmp(cmd, "CRS") && gd) {
    n += snprintf(buf + n, bufsize - n, "%u", (unsigned int)gd->heading);
  } else {
    n += snprintf(buf + n, bufsize - n, "ERROR");
  }
  Serial.print(" -> ");
  Serial.println((p = strchr(buf, '\r')) ? p + 1 : buf);
  if (n < bufsize - 1) {
    buf[n++] = '\r';
  } else {
    n = bufsize - 1;
  }
  buf[n] = 0;
  ble_send_response(buf, n, cmd);
#else
  if (timeout) delay(timeout);
#endif
}

void setup()
{
  delay(500);

  // Initialize NVS
  esp_err_t err = nvs_flash_init();
  if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
    // NVS partition was truncated and needs to be erased
    // Retry nvs_flash_init
    ESP_ERROR_CHECK(nvs_flash_erase());
    err = nvs_flash_init();
  }
  ESP_ERROR_CHECK( err );
  err = nvs_open("storage", NVS_READWRITE, &nvs);
  if (err == ESP_OK) {
    loadConfig();
  }

  // FCM patch: load the app-managed config store and apply it to the runtime
  // switches, then create the protocol client and storage logger it selected.
  // Must happen before anything below consults the fcm* globals, and before
  // the telemetry task starts (fcmApplyConfig snapshots the credential
  // Strings the telemetry task must never read live).
  fcmLiveMux = xSemaphoreCreateMutex();
  cfg.load();
  fcmApplyConfig(cfg);
  if (fcmProto == PROTOCOL_UDP) {
    teleClient = new TeleClientUDP;
  } else {
    teleClient = new TeleClientHTTP;
  }
  if (fcmStorage == STORAGE_SD) {
    logger = new SDLogger;
  } else if (fcmStorage == STORAGE_SPIFFS) {
    logger = new SPIFFSLogger;
  }

#if ENABLE_OLED
  oled.begin();
  oled.setFontSize(FONT_SIZE_SMALL);
#endif
  // initialize USB serial
  Serial.begin(115200);
  // FCM patch: readStringUntil() in processSerial blocks up to the Stream
  // default timeout (1000ms!) when a partial line sits in the buffer — called
  // from loop() and the standby wait loops, a stray byte would stall telemetry
  // and motion detection for a second per call. Keep the wait short.
  Serial.setTimeout(50);

  // init LED pin
#ifdef PIN_LED
  pinMode(PIN_LED, OUTPUT);
  if (ledMode == 0) digitalWrite(PIN_LED, HIGH);
#endif

  // generate unique device ID
  genDeviceID(devid);

#if CONFIG_MODE_TIMEOUT
  configMode();
#endif

#if LOG_EXT_SENSORS == 1
  pinMode(PIN_SENSOR1, INPUT);
  pinMode(PIN_SENSOR2, INPUT);
#elif LOG_EXT_SENSORS == 2
  adc1_config_width(ADC_WIDTH_BIT_12);
  adc1_config_channel_atten(ADC1_CHANNEL_0, ADC_ATTEN_DB_11);
  adc1_config_channel_atten(ADC1_CHANNEL_1, ADC_ATTEN_DB_11);
#endif

  // show system information
  showSysInfo();

  bufman.init();
  
  //Serial.print(heap_caps_get_free_size(MALLOC_CAP_SPIRAM) >> 10);
  //Serial.println("KB");

#if ENABLE_OBD
  if (sys.begin()) {
    Serial.print("TYPE:");
    Serial.println(sys.devType);
    obd.begin(sys.link);
  }
#else
  sys.begin(false, true);
#endif

#if ENABLE_MEMS
// FCM patch: probe the motion sensor only when enabled at runtime; when
// skipped, mems stays null and STATE_MEMS_READY stays clear, so every MEMS
// code path degrades exactly like an ENABLE_MEMS=0 build.
if (fcmMems && !state.check(STATE_MEMS_READY)) do {
  Serial.print("MEMS:");
  mems = new ICM_42627;
  byte ret = mems->begin();
  if (ret) {
    state.set(STATE_MEMS_READY);
    Serial.println("ICM-42627");
    break;
  }
  delete mems;
  mems = new ICM_20948_I2C;
  ret = mems->begin();
  if (ret) {
    state.set(STATE_MEMS_READY);
    Serial.println("ICM-20948");
    break;
  } 
  delete mems;
  /*
  mems = new MPU9250;
  ret = mems->begin();
  if (ret) {
    state.set(STATE_MEMS_READY);
    Serial.println("MPU-9250");
    break;
  }
  */
  mems = 0;
  Serial.println("NO");
} while (0);
#endif

#if ENABLE_HTTPD
  // FCM patch: start the HTTP server (and its WiFi soft-AP) only when enabled
  // at runtime; serverProcess() degrades to a plain delay otherwise.
  if (fcmHttpd) {
    IPAddress ip;
    if (serverSetup(ip)) {
      Serial.println("HTTPD:");
      Serial.println(ip);
#if ENABLE_OLED
      oled.println(ip);
#endif
    } else {
      Serial.println("HTTPD:NO");
    }
  }
#endif

  state.set(STATE_WORKING);

#if ENABLE_BLE
  // FCM patch: init BLE only when enabled at runtime (processBLE falls back
  // to a plain delay when the queue was never created). With BLE disabled,
  // hand the Bluetooth controller's static RAM reservation (~50KB on a 320KB
  // chip) back to the heap — compiling BLE in must not cost disabled devices
  // the memory.
  if (fcmBle) {
    ble_init("FreematicsPlus");
  } else {
    esp_bt_controller_mem_release(ESP_BT_MODE_BTDM);
  }
#endif

  // initialize components
  initialize();

  // initialize network and maintain connection
  subtask.create(telemetry, "telemetry", 2, 8192);

#ifdef PIN_LED
  digitalWrite(PIN_LED, LOW);
#endif
}

void loop()
{
  // FCM patch: service the desktop configurator first. While a config command
  // is in flight, skip telemetry so the shared UART stays quiet and replies
  // are prompt; while any command was seen recently (keep-awake), skip
  // standby() so the device stays serial-responsive for the whole session.
  processSerial(cfg);
  if (fcmInConfig()) { delay(2); return; }

  // error handling
  if (!state.check(STATE_WORKING)) {
    if (fcmAwake()) { delay(5); return; }
    standby();
#ifdef PIN_LED
    if (ledMode == 0) digitalWrite(PIN_LED, HIGH);
#endif
    initialize();
#ifdef PIN_LED
    digitalWrite(PIN_LED, LOW);
#endif
    return;
  }

  // collect and log data
  process();
}

// ---------------------------------------------------------------------------
// FCM: apply the stored config to the runtime switches. Called once at boot
// (setup) before the protocol client / logger / feature init consult them.
// Strings override only when non-empty and numerics only when > 0, so an
// unset field keeps the compile-time default and a polluted store can't
// brick the device. Selection strings mirror the app's enum encodings.
// ---------------------------------------------------------------------------
void fcmApplyConfig(Config& c)
{
  // credentials
  if (c.apn.length())  { strncpy(apn, c.apn.c_str(), sizeof(apn) - 1); apn[sizeof(apn) - 1] = 0; }
#if ENABLE_WIFI
  if (c.ssid.length()) { strncpy(wifiSSID, c.ssid.c_str(), sizeof(wifiSSID) - 1); wifiSSID[sizeof(wifiSSID) - 1] = 0; }
  if (c.wpwd.length()) { strncpy(wifiPassword, c.wpwd.c_str(), sizeof(wifiPassword) - 1); wifiPassword[sizeof(wifiPassword) - 1] = 0; }
#endif
  // cellular credential snapshots for the telemetry task (see declarations)
  if (c.sim_pin.length())  { strncpy(fcmSimPin, c.sim_pin.c_str(), sizeof(fcmSimPin) - 1); fcmSimPin[sizeof(fcmSimPin) - 1] = 0; }
  if (c.apn_user.length()) { strncpy(fcmApnUser, c.apn_user.c_str(), sizeof(fcmApnUser) - 1); fcmApnUser[sizeof(fcmApnUser) - 1] = 0; }
  if (c.apn_pass.length()) { strncpy(fcmApnPass, c.apn_pass.c_str(), sizeof(fcmApnPass) - 1); fcmApnPass[sizeof(fcmApnPass) - 1] = 0; }
  // tunables (0 = keep firmware default)
  if (c.motion_thr > 0)   fcmMotionThr   = c.motion_thr;
  if (c.max_obd_err > 0)  fcmMaxObdErr   = c.max_obd_err;
  if (c.gnss_reset_t > 0) fcmGnssResetT  = c.gnss_reset_t;
  // pingback deliberately breaks the "0 = keep firmware default" rule: the
  // app documents 0 as "disable ping-backs", so honor that (the standby loop
  // treats fcmPingbackInt <= 0 as never-ping).
  fcmPingbackInt = c.pingback_int > 0 ? c.pingback_int : 0;
  if (c.cooling_t > 0)    fcmCoolingT    = c.cooling_t;
  if (c.jumpstart_v > 0)  fcmJumpstartV  = c.jumpstart_v / 1000.0f; // mV -> V
  if (c.srv_sync_int > 0) syncInterval   = (int32_t)c.srv_sync_int * 1000;
  // feature toggles
  fcmObd = c.obd;
  fcmMems = c.mems;
  fcmBle = c.ble;
  fcmHttpd = c.httpd;
  fcmGnssAlways = c.gnss_always;
  // selections
  if (c.gnss == "none") fcmGnss = GNSS_NONE;
  else if (c.gnss == "cellular") fcmGnss = GNSS_CELLULAR;
  else fcmGnss = GNSS_STANDALONE;
  if (c.storage == "sd") fcmStorage = STORAGE_SD;
  else if (c.storage == "spiffs") fcmStorage = STORAGE_SPIFFS;
  else fcmStorage = STORAGE_NONE;
  fcmSrvMethodGet = (c.srv_proto == "https_get");
  fcmProto = (c.srv_proto == "https_get" || c.srv_proto == "https_post")
      ? PROTOCOL_HTTPS_POST : PROTOCOL_UDP;
  // server endpoint
  if (c.srv_host.length()) { strncpy(fcmSrvHost, c.srv_host.c_str(), sizeof(fcmSrvHost) - 1); fcmSrvHost[sizeof(fcmSrvHost) - 1] = 0; }
  if (c.srv_port) fcmSrvPort = c.srv_port;
  else fcmSrvPort = (fcmProto == PROTOCOL_UDP) ? 8081 : 443;
  if (c.srv_path.length()) { strncpy(fcmSrvPath, c.srv_path.c_str(), sizeof(fcmSrvPath) - 1); fcmSrvPath[sizeof(fcmSrvPath) - 1] = 0; }
  // WiFi soft-AP (HTTP server)
  if (c.ap_ssid.length()) { strncpy(fcmApSSID, c.ap_ssid.c_str(), sizeof(fcmApSSID) - 1); fcmApSSID[sizeof(fcmApSSID) - 1] = 0; }
  if (c.ap_pwd.length())  { strncpy(fcmApPwd, c.ap_pwd.c_str(), sizeof(fcmApPwd) - 1); fcmApPwd[sizeof(fcmApPwd) - 1] = 0; }
}

// ---------------------------------------------------------------------------
// FCM: close the active log before an app-triggered REBOOT (strong override
// of the weak hook in serial_handler.cpp) — same shutdown the BLE RESET path
// performs, so a restart can't lose/corrupt the open SD/SPIFFS log file.
// ---------------------------------------------------------------------------
void fcmPrepareRestart()
{
  if (logger) logger->end();
}

// ---------------------------------------------------------------------------
// FCM: mutex-guarded access to the netop/ip String globals. The telemetry
// task reassigns them (connect/standby) while the loop task reads them for
// serial live queries and BLE — an unguarded concurrent read of an Arduino
// String being reassigned is a use-after-free.
// ---------------------------------------------------------------------------
static void fcmSetNetop(const String& v)
{
  if (fcmLiveMux) xSemaphoreTake(fcmLiveMux, portMAX_DELAY);
  netop = v;
  if (fcmLiveMux) xSemaphoreGive(fcmLiveMux);
}

static void fcmSetIp(const String& v)
{
  if (fcmLiveMux) xSemaphoreTake(fcmLiveMux, portMAX_DELAY);
  ip = v;
  if (fcmLiveMux) xSemaphoreGive(fcmLiveMux);
}

static String fcmCopyLive(const String& src)
{
  if (fcmLiveMux) xSemaphoreTake(fcmLiveMux, portMAX_DELAY);
  String out = src;
  if (fcmLiveMux) xSemaphoreGive(fcmLiveMux);
  return out;
}

// ---------------------------------------------------------------------------
// FCM: live telemetry hook backing the serial BATT/RSSI/GPS/NET_* queries
// (strong override of the weak default in serial_handler.cpp). NET_IP reports
// the IP cached at connection time — never a blocking modem AT command.
// ---------------------------------------------------------------------------
String fcmLiveQuery(const String& key)
{
  if (key == "BATT")   return batteryVoltage > 0 ? String(batteryVoltage, 1) : String("N/A");
  if (key == "RSSI")   return rssi ? String((int)rssi) : String("N/A");
  if (key == "VIN")    return vin[0] ? String(vin) : String("N/A");
  if (key == "UPTIME") return String((unsigned long)millis());
  if (key == "NET_OP") { String v = fcmCopyLive(netop); return v.length() ? v : String("N/A"); }
  if (key == "NET_IP") { String v = fcmCopyLive(ip); return v.length() ? v : String("N/A"); }
  if (gd && gd->ts) {
    if (key == "LAT") return String(gd->lat, 6);
    if (key == "LNG") return String(gd->lng, 6);
    if (key == "ALT") return String(gd->alt, 1);
    if (key == "SAT") return String((int)gd->sat);
    if (key == "SPD") return String(gd->speed * 1.852f, 1); // knots -> km/h
    if (key == "CRS") return String((int)gd->heading);
  }
  return "N/A";
}
