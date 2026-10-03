FROM ros:humble-ros-base

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
      ros-humble-foxglove-bridge \
      ros-humble-tf2-ros \
      ros-humble-diagnostic-msgs \
      python3-pip \
    && rm -rf /var/lib/apt/lists/*

RUN pip3 install --no-cache-dir paho-mqtt

WORKDIR /app
COPY . /app/

RUN sed -i 's/\r$//' /app/entrypoint.sh && chmod +x /app/entrypoint.sh

EXPOSE 8765
ENTRYPOINT ["/app/entrypoint.sh"]