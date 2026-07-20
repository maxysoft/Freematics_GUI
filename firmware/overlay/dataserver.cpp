/*************************************************************************
* Vehicle Telemetry Data Logger for Freematics ONE+
*
* Developed by Stanley Huang <stanley@freematics.com.au>
* Distributed under BSD license
* Visit https://freematics.com/products/freematics-one-plus for more info
*
* THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
* IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
* FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
* AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
* LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
* OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
* THE SOFTWARE.
*
* Implemented HTTP APIs:
* /api/info - device info
* /api/live - live data (OBD/GPS/MEMS)
* /api/control - issue a control command
* /api/list - list of log files
* /api/log/<file #> - raw CSV format log file
* /api/delete/<file #> - delete file
* /api/data/<file #>?pid=<PID in hex> - JSON array of PID data
*************************************************************************/

#include <SPI.h>
#include <FS.h>
#include <SD.h>
#include <SPIFFS.h>
#include <FreematicsPlus.h>
#include <WiFi.h>
#include <SPIFFS.h>
#include <apps/sntp/sntp.h>
#include <esp_spi_flash.h>
#include <esp_err.h>
#include <httpd.h>
#include "config.h"

#if ENABLE_HTTPD

#define WIFI_TIMEOUT 5000

// FCM patch: type must match the definition in telelogger.ino (`int fileid`);
// the upstream `extern uint32_t` was an ODR violation that linked silently.
extern int fileid;

// FCM patch: storage backend + soft-AP credentials come from the stored
// config at runtime (defined/seeded in telelogger.ino). fcmHttpdStarted stops
// serverProcess() from calling mwHttpLoop() on an uninitialized httpParam
// when the HTTP server is disabled in config.
extern uint8_t fcmStorage;      // STORAGE_NONE / STORAGE_SPIFFS / STORAGE_SD
extern char fcmApSSID[];
extern char fcmApPwd[];
bool fcmHttpdStarted = false;

extern "C"
{
uint8_t temprature_sens_read();
uint32_t hall_sens_read();
}

HttpParam httpParam;

int handlerLiveData(UrlHandlerParam* param);
int handlerControl(UrlHandlerParam* param);

uint16_t hex2uint16(const char *p);

int handlerInfo(UrlHandlerParam* param)
{
    char *buf = param->pucBuffer;
    int bufsize = param->bufSize;
    int bytes = snprintf(buf, bufsize, "{\"httpd\":{\"uptime\":%u,\"clients\":%u,\"requests\":%u,\"traffic\":%u},\n",
        (unsigned int)millis(), httpParam.stats.clientCount, (unsigned int)httpParam.stats.reqCount, (unsigned int)(httpParam.stats.totalSentBytes >> 10));

    time_t now;
    time(&now);
    struct tm timeinfo = { 0 };
    localtime_r(&now, &timeinfo);
    if (timeinfo.tm_year) {
        bytes += snprintf(buf + bytes, bufsize - bytes, "\"rtc\":{\"date\":\"%04u-%02u-%02u\",\"time\":\"%02u:%02u:%02u\"},\n",
        timeinfo.tm_year + 1900, timeinfo.tm_mon + 1, timeinfo.tm_mday,
        timeinfo.tm_hour, timeinfo.tm_min, timeinfo.tm_sec);
    }

    int deviceTemp = (int)temprature_sens_read() * 165 / 255 - 40;
    bytes += snprintf(buf + bytes, bufsize - bytes, "\"cpu\":{\"temperature\":%d,\"magnetic\":%d},\n",
        deviceTemp, hall_sens_read());

    if (fcmStorage == STORAGE_SPIFFS) {
        bytes += snprintf(buf + bytes, bufsize - bytes, "\"spiffs\":{\"total\":%u,\"used\":%u}",
            SPIFFS.totalBytes(), SPIFFS.usedBytes());
    } else if (fcmStorage == STORAGE_SD) {
        bytes += snprintf(buf + bytes, bufsize - bytes, "\"sd\":{\"total\":%llu,\"used\":%llu}",
            SD.totalBytes(), SD.usedBytes());
    } else {
        bytes += snprintf(buf + bytes, bufsize - bytes, "\"storage\":null");
    }

    if (bytes < bufsize - 1) buf[bytes++] = '}';

    param->contentLength = bytes;
    param->contentType=HTTPFILETYPE_JSON;
    return FLAG_DATA_RAW;
}

class LogDataContext {
public:
    File file;
    uint32_t tsStart;
    uint32_t tsEnd;
    uint16_t pid;
};

int handlerLogFile(UrlHandlerParam* param)
{
    LogDataContext* ctx = (LogDataContext*)param->hs->ptr;
    param->contentType = HTTPFILETYPE_TEXT;
    if (ctx) {
		if (!param->pucBuffer) {
			// connection to be closed, final calling, cleanup
			ctx->file.close();
            delete ctx;
			param->hs->ptr = 0;
			return 0;
		}
    } else {
        int id = 0;
        if (param->pucRequest[0] == '/') {
            id = atoi(param->pucRequest + 1);
        }
        sprintf(param->pucBuffer, "/DATA/%u.CSV", id == 0 ? fileid : id);
        ctx = new LogDataContext;
        if (fcmStorage == STORAGE_SPIFFS)
            ctx->file = SPIFFS.open(param->pucBuffer, FILE_READ);
        else if (fcmStorage == STORAGE_SD)
            ctx->file = SD.open(param->pucBuffer, FILE_READ);
        if (!ctx->file) {
            strcat(param->pucBuffer, " not found");
            param->contentLength = strlen(param->pucBuffer);
            delete ctx;
            return FLAG_DATA_RAW;
        }
        param->hs->ptr = (void*)ctx;
    }

    if (!ctx->file.available()) {
        // EOF
        return 0;
    }
    param->contentLength = ctx->file.readBytes(param->pucBuffer, param->bufSize);
    param->contentType = HTTPFILETYPE_TEXT;
    return FLAG_DATA_STREAM;
}

int handlerLogData(UrlHandlerParam* param)
{
    uint32_t duration = 0;
    LogDataContext* ctx = (LogDataContext*)param->hs->ptr;
    param->contentType = HTTPFILETYPE_JSON;
    if (ctx) {
		if (!param->pucBuffer) {
			// connection to be closed, final calling, cleanup
			ctx->file.close();
            delete ctx;
			param->hs->ptr = 0;
			return 0;
		}
    } else {
        int id = 0;
        if (param->pucRequest[0] == '/') {
            id = atoi(param->pucRequest + 1);
        }
        sprintf(param->pucBuffer, "/DATA/%u.CSV", id == 0 ? fileid : id);
        ctx = new LogDataContext;
        if (fcmStorage == STORAGE_SPIFFS)
            ctx->file = SPIFFS.open(param->pucBuffer, FILE_READ);
        else if (fcmStorage == STORAGE_SD)
            ctx->file = SD.open(param->pucBuffer, FILE_READ);
        if (!ctx->file) {
            param->contentLength = sprintf(param->pucBuffer, "{\"error\":\"Data file not found\"}");
            delete ctx;
            return FLAG_DATA_RAW;
        }
        ctx->pid = mwGetVarValueHex(param->pxVars, "pid", 0);
        ctx->tsStart = mwGetVarValueInt(param->pxVars, "start", 0);
        ctx->tsEnd = 0xffffffff;
        duration = mwGetVarValueInt(param->pxVars, "duration", 0);
        if (ctx->tsStart && duration) {
            ctx->tsEnd = ctx->tsStart + duration;
            duration = 0;
        }
        param->hs->ptr = (void*)ctx;
        // JSON head
        param->contentLength = sprintf(param->pucBuffer, "[");
    }
    
    int len = 0;
    char buf[64];
    uint32_t ts = 0;

    for (;;) {
        int c = ctx->file.read();
        if (c == -1) {
            if (param->contentLength == 0) {
                // EOF
                return 0;
            }
            // JSON tail
            if (param->pucBuffer[param->contentLength - 1] == ',') param->contentLength--;
            param->pucBuffer[param->contentLength++] = ']';
            break;
        }
        if (c == '\n') {
            // line end, process the line
            buf[len] = 0;
            char *value = strchr(buf, ',');
            if (value++) {
                uint16_t pid = hex2uint16(buf);
                if (pid == 0) {
                    // timestamp
                    ts = atoi(value);
                    if (duration) {
                        ctx->tsEnd = ts + duration;
                        duration = 0;
                    }
                } else if (pid == ctx->pid && ts >= ctx->tsStart && ts < ctx->tsEnd) {
                    // generate json array element
                    param->contentLength += snprintf(param->pucBuffer + param->contentLength, param->bufSize - param->contentLength,
                        "[%u,%s],", ts, value);
                }
            }
            len = 0;
            if (param->contentLength + 32 > param->bufSize) break;
        } else if (len < sizeof(buf) - 1) {
            buf[len++] = c;
        }
    }
    return FLAG_DATA_STREAM;
}

int handlerLogList(UrlHandlerParam* param)
{
    char *buf = param->pucBuffer;
    int bufsize = param->bufSize;
    File file;
    File root;
    if (fcmStorage == STORAGE_SPIFFS)
        root = SPIFFS.open("/");
    else if (fcmStorage == STORAGE_SD)
        root = SD.open("/DATA");
    int n = snprintf(buf, bufsize, "[");
    if (root) {
        while(file = root.openNextFile()) {
            const char *fn = file.name();
            if (!strncmp(fn, "/DATA/", 6)) {
                fn += 6;
                unsigned int size = file.size();
                Serial.print(fn);
                Serial.print(' ');
                Serial.print(size);
                Serial.println(" bytes");
                unsigned int id = atoi(fn);
                if (id) {
                    n += snprintf(buf + n, bufsize - n, "{\"id\":%u,\"size\":%u",
                        id, size);
                    if (id == fileid) {
                        n += snprintf(buf + n, bufsize - n, ",\"active\":true");
                    }
                    n += snprintf(buf + n, bufsize - n, "},");
                }
            }
        }
        if (buf[n - 1] == ',') n--;
    }
    n += snprintf(buf + n, bufsize - n, "]");
    param->contentType=HTTPFILETYPE_JSON;
    param->contentLength = n;
    return FLAG_DATA_RAW;
}

int handlerLogDelete(UrlHandlerParam* param)
{
    int id = 0;
    if (param->pucRequest[0] == '/') {
        id = atoi(param->pucRequest + 1);
    }
    sprintf(param->pucBuffer, "/DATA/%u.CSV", id);
    if (id == fileid) {
        strcat(param->pucBuffer, " still active");
    } else {
        bool removal = false;
        if (fcmStorage == STORAGE_SPIFFS)
            removal = SPIFFS.remove(param->pucBuffer);
        else if (fcmStorage == STORAGE_SD)
            removal = SD.remove(param->pucBuffer);
        if (removal) {
            strcat(param->pucBuffer, " deleted");
        } else {
            strcat(param->pucBuffer, " not found");
        }
    }
    param->contentLength = strlen(param->pucBuffer);
    param->contentType = HTTPFILETYPE_TEXT;
    return FLAG_DATA_RAW;
}

UrlHandler urlHandlerList[]={
    {"api/live", handlerLiveData},
    {"api/info", handlerInfo},
#if STORAGE != STORAGE_NONE
    {"api/list", handlerLogList},
    {"api/data", handlerLogData},
    {"api/log", handlerLogFile},
    {"api/delete", handlerLogDelete},
#endif
    {0}
};

void obtainTime()
{
    sntp_setoperatingmode(SNTP_OPMODE_POLL);
    sntp_setservername(0, (char*)"pool.ntp.org");
    sntp_init();
}

void serverProcess(int timeout)
{
    // FCM patch: when the HTTP server is disabled at runtime, this must behave
    // like the ENABLE_HTTPD=0 stub — plain delay — because the sketch uses
    // serverProcess() as its loop pacing sleep. Calling mwHttpLoop() on an
    // uninitialized httpParam would crash.
    // timeout is int and waitMotion() can pass -1 ("forever"); delay() takes
    // uint32_t, so a negative value would sleep ~49 days. Clamp it.
    if (!fcmHttpdStarted) {
        if (timeout > 0) delay(timeout);
        return;
    }
    mwHttpLoop(&httpParam, timeout);
}

bool serverSetup(IPAddress& ip)
{
#if NET_DEVICE == NET_WIFI
    WiFi.mode (WIFI_AP_STA);
#else
    WiFi.mode (WIFI_AP);
#endif

    // FCM patch: soft-AP name from the stored config (compile default when
    // unset). The password is used AS-IS: a blank password means an OPEN AP,
    // exactly what the app promises — falling back to the compile-time
    // WIFI_AP_PASSWORD here would silently protect the AP with the publicly
    // documented upstream default ("PASSWORD").
    WiFi.softAP(fcmApSSID[0] ? fcmApSSID : WIFI_AP_SSID,
                fcmApPwd[0] ? fcmApPwd : (const char*)0);
    ip = WiFi.softAPIP();

    mwInitParam(&httpParam, 80, "/spiffs");
    httpParam.pxUrlHandler = urlHandlerList;
    httpParam.maxClients = 4;

    if (mwServerStart(&httpParam)) {
        return false;
    }

#if NET_DEVICE == NET_WIFI
    obtainTime();
#endif
    fcmHttpdStarted = true;
    return true;
}

#else

void serverProcess(int timeout)
{
    delay(timeout);
}

#endif
