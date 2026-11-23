#!/usr/bin/env python3
"""
TEMPLATE (SOLAR): read the solar inverter over Modbus TCP and publish to Zeek Power over MQTT every 4 s.

Run this on a small computer at the turbine (Raspberry Pi, industrial gateway, mini PC).
It is a template: the register map below is EMPTY on purpose. Fill it in from your inverter
(and weather-sensor) manual (register address, data type, scale). Nothing here is guessed.

  pip install pymodbus paho-mqtt
  python3 modbus_to_mqtt.py
"""
import json, time, sys
import paho.mqtt.client as mqtt
from pymodbus.client import ModbusTcpClient          # for RS-485 use ModbusSerialClient instead

# ---- connection settings ------------------------------------------------------------
CONTROLLER_HOST, CONTROLLER_PORT, UNIT_ID = "192.168.1.60", 502, 1   # <- your inverter / data logger
MQTT_HOST, MQTT_PORT = "your-vps-domain-or-ip", 1883                # use 8883 + TLS in production
DEVICE_ID = "zp-solar-01"                                           # same id as add-solar
MQTT_PASSWORD = "the-password-from-add-mqtt-device"
INTERVAL = 4                                                        # seconds (3-5)

# ---- register map: FILL IN from the controller manual -------------------------------
# field name in Zeek Power -> (register address, kind, scale)   kind: "u16" | "s16" | "u32"
# Example line (NOT real addresses):   "rotor_rpm": (40010, "u16", 0.1),
REGISTERS = {
    # Send only what your inverter / sensors provide. Every field is optional.
    # "power_kw":        (?, "s16", ?),   # AC output, kW
    # "dc_voltage_v":    (?, "u16", ?),   # V
    # "dc_current_a":    (?, "u16", ?),   # A
    # "ac_voltage_v":    (?, "u16", ?),   # V
    # "ac_current_a":    (?, "u16", ?),   # A
    # "frequency_hz":    (?, "u16", ?),   # Hz
    # "inverter_temp_c": (?, "s16", ?),   # degC
    # "irradiance_wm2":  (?, "u16", ?),   # W/m2 from a pyranometer / reference cell
    # "panel_temp_c":    (?, "s16", ?),   # degC, back-of-module sensor
    # "ambient_temp_c":  (?, "s16", ?),   # degC
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
    topic = f"zeekpower/solar/{DEVICE_ID}/telemetry"
    while True:
        started = time.time()
        try:
            if not modbus.connected:
                modbus.connect()
            data = read_all(modbus)
            if data:
                # status: "running" while generating, "standby" at night, "fault" on an inverter fault code
                data.setdefault("status", "running" if data.get("power_kw", 0) > 0.05 else "standby")
                client.publish(topic, json.dumps(data), qos=1)
        except Exception as e:                           # never crash the loop
            print("read error:", e)
        time.sleep(max(0.5, INTERVAL - (time.time() - started)))

if __name__ == "__main__":
    main()
