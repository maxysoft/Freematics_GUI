#ifndef SERIAL_HANDLER_H
#define SERIAL_HANDLER_H

#include "configstore.h"

// Mirrors processBLE(): reads one line from Serial, dispatches command.
// All responses terminated with \r\n.
void processSerial(Config& cfg);

#endif
