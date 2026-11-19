#!/usr/bin/env python3
"""
TEMPLATE: read the turbine controller over Modbus TCP and publish to ZeekWind over MQTT every 4 s.

Run this on a small computer at the turbine (Raspberry Pi, industrial gateway, mini PC).
It is a template: the register map below is EMPTY on purpose. Fill it in from your turbine
controller / inverter manual (register address, data type, scale). Nothing here is guessed.

  pip install pymodbus paho-mqtt
  python3 modbus_to_mqtt.py
"""
import json, time, sys
import paho.mqtt.client as mqtt
from pymodbus.client import ModbusTcpClient          # for RS-485 use ModbusSerialClient instead

# ---- connection settings ------------------------------------------------------------
CONTROLLER_HOST, CONTROLLER_PORT, UNIT_ID = "192.168.1.50", 502, 1   # <- your controller
MQTT_HOST, MQTT_PORT = "your-vps-domain-or-ip", 1883                # use 8883 + TLS in production
DEVICE_ID = "zw-65kw-01"                                            # same id as add-turbine
MQTT_PASSWORD = "the-password-from-add-mqtt-device"
INTERVAL = 4                                                        # seconds (3-5)

# ---- register map: FILL IN from the controller manual -------------------------------
# field name in ZeekWind -> (register address, kind, scale)   kind: "u16" | "s16" | "u32"
# Example line (NOT real addresses):   "rotor_rpm": (40010, "u16", 0.1),
REGISTERS = {
    # "wind_speed":   (?, "u16", ?),   # m/s
    # "wind_direction": (?, "u16", ?), # degrees 0-360 (wind comes FROM)
    # "rotor_rpm":    (?, "u16", ?),   # rpm
    # "power_kw":     (?, "s16", ?),   # kW
    # "voltage_v":    (?, "u16", ?),   # V
    # "current_a":    (?, "u16", ?),   # A
    # "frequency_hz": (?, "u16", ?),   # Hz
    # "yaw_angle":    (?, "u16", ?),   # degrees 0-360
}

def read_all(modbus):
    out = {}
    for name, (addr, kind, scale) in REGISTERS.items():
        count = 2 if kind == "u32" else 1
        rr = modbus.read_holding_registers(addr, count=count, slave=UNIT_ID)
        if rr.isError():
            continue                                   # skip a field that failed; send the rest
        r = rr.registers
        raw = (r[0] << 16 | r[1]) if kind == "u32" else (r[0] - 65536 if kind == "s16" and r[0] > 32767 else r[0])
        out[name] = round(raw * scale, 3)
    return out

def main():
    if not REGISTERS:
        sys.exit("Fill in REGISTERS first (see comments).")
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=DEVICE_ID + "-gw")
    client.username_pw_set(DEVICE_ID, MQTT_PASSWORD)
    client.connect_async(MQTT_HOST, MQTT_PORT)          # auto-reconnects when the link drops
    client.loop_start()
    modbus = ModbusTcpClient(CONTROLLER_HOST, port=CONTROLLER_PORT)
    topic = f"zeekwind/turbines/{DEVICE_ID}/telemetry"
    while True:
        started = time.time()
        try:
            if not modbus.connected:
                modbus.connect()
            data = read_all(modbus)
            if data:
                client.publish(topic, json.dumps(data), qos=1)
        except Exception as e:                           # never crash the loop
            print("read error:", e)
        time.sleep(max(0.5, INTERVAL - (time.time() - started)))

if __name__ == "__main__":
    main()
