FROM python:3.11-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PIO_CORE_DIR=/pio-core \
    PIO_WORKSPACE_DIR=/pio-work

RUN apt-get update && apt-get install -y --no-install-recommends \
        git \
        curl \
        ca-certificates \
        build-essential \
        cmake \
        ninja-build \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir platformio==6.1.16

WORKDIR /firmware

# Overlay + build script are mounted via docker-compose; copy defaults in.
COPY overlay/ /firmware/overlay/
COPY test/    /firmware/test/
COPY build.sh /firmware/build.sh
RUN chmod +x /firmware/build.sh

CMD ["sleep", "infinity"]
