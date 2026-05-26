# Espresso Firmware

PlatformIO Arduino-ESP32 firmware for the offline signer/uplink device and the satellite ground receiver.

## Wiring

- ESP32 dev board.
- SSD1306 OLED on I2C address `0x3C`.
- SX127x LoRa module using the default firmware pins:
  - NSS `18`
  - DIO0 `26`
  - RESET `14`
  - DIO1 `35`
- Iridium SBD-compatible modem on UART2:
  - ESP32 RX `16`
  - ESP32 TX `17`
  - baud `19200`

Adjust `firmware/src/lora_transport.cpp` if your board uses different radio pins.

## Flashing

Build both firmware roles:

```sh
cd firmware
pio run
```

Flash the user/offline signer:

```sh
pio run -e user-device -t upload
pio device monitor -e user-device
```

Flash the satellite ground receiver:

```sh
pio run -e ground-receiver -t upload
pio device monitor -e ground-receiver
```

The `user-device` target signs and transmits frames over serial, LoRa, and Iridium SBD when the modem is detected. The `ground-receiver` target polls the satellite modem for mobile-originated SBD payloads and prints one hex-encoded Espresso frame per line. The Node ground station consumes those lines through `SERIAL_PORT_PATH`.

## Byte Verification

After flashing `user-device`, verify firmware raw transaction bytes against the TypeScript core reference:

```sh
FIRMWARE_VERIFY_PORT=/dev/tty.usbserial-0001 pnpm --filter @espresso/ground-station verify:firmware
```

The verifier sends a deterministic `VERIFY_SEPOLIA ...` command to the ESP32 and fails if the returned raw tx differs from `packages/core`.

## Funding

The device is non-custodial. Its generated EVM address must be funded directly with:

- Sepolia ETH for Sepolia transactions.
- Arkiv Braga test tokens for Arkiv entity-create transactions.

The ground station does not fund, alter, wrap, or re-sign user transactions.
