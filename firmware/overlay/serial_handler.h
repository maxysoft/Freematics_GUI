#ifndef SERIAL_HANDLER_H
#define SERIAL_HANDLER_H

#include "configstore.h"

// Mirrors processBLE(): reads one line from Serial, dispatches command.
// All responses terminated with \r\n.
void processSerial(Config& cfg);

// True while a config command (dump/set/save/load) was received recently. The
// main loop() uses this to skip its telemetry/upload work so the shared UART
// stays quiet and responsive during configuration. Live-data queries do NOT
// extend the window, so normal telemetry keeps flowing while polling.
bool fcmInConfig();

// True while ANY serial command (config or live query) was received recently.
// The main loop() uses this to skip standby()/sleep so a connected configurator
// keeps the device awake and serial-responsive instead of parking it.
bool fcmAwake();

#endif
