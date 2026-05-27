# Espresso

**Theme: DePIN** (a queryable, tamper-proof data layer for device telemetry).

Espresso is a non-custodial offline-signing and satellite/radio-uplink prototype where **all relay data lives on Arkiv**. An ESP32 signs a raw EVM transaction locally, chunks it into MTU-sized frames, and sends it over serial, LoRa, or an Iridium SBD satellite modem. A second ESP32 acts as the satellite ground receiver and forwards frames over USB serial to the Node ground station, which reassembles the bytes, submits the exact signed transaction to the destination RPC, and records the whole lifecycle on Arkiv — owned by the user who signed it.

> Submissions can also be **scheduled**: a device may attach a "submit-after" time, and the signed tx is parked on Arkiv as a queued entity until it's due — surviving ground-station restarts.

## Architecture

```
ESP32 (offline signer)
  │  raw EVM tx → Espresso frames (CRC16, MTU chunks)
  ├── serial ──┐
  ├── LoRa  ───┤→ ground-receiver ESP32 → USB serial
  └── Iridium ─┘
                    ▼
        Ground station (Hono / Node)
          • reassembles frames
          • submits raw tx → Sepolia RPC
          • records lifecycle on Arkiv Braga
          • durable queue + restart recovery
                    ▼
        Arkiv Braga (the data layer)        Dashboard (Next.js)
          device / submission / receipt  ◄── live submissions + audit explorer
```

## Arkiv integration

Arkiv is the primary data layer. The SDK client lives in [`packages/core/src/arkiv/client.ts`](packages/core/src/arkiv/client.ts).

**Unique project attribute** — every entity and every query is namespaced with
`PROJECT_ATTRIBUTE = { key: "project", value: "espresso-ns05-arkiv" }`.

**Three entity types** (same project, distinguished by `kind`):

| Entity | `kind` | Payload | Key indexed attributes | TTL | Ownership |
| --- | --- | --- | --- | --- | --- |
| **device** | `device` | `address`, `label`, `firstSeenTs` | `address` | 365 d | station |
| **submission** | `submission` | `txHash`, `from`, `chainId`, `rawTx`, `ts`, `submitAfter?`, `status` | `txHash`, `from`, `chainId` (num), `status`, `submitAfter` (num), `deviceKey` | 30 d (→90 d on failure) | station |
| **receipt** | `receipt` | `txHash`, `from`, `chainId`, `status`, `ts`, `submissionKey`, `blockNumber?` | `txHash`, `status`, `submissionKey`, `deviceKey` | 90 d | **user** |

**Relationships** (shared-attribute foreign keys): `submission.deviceKey → device` and `receipt.submissionKey → submission` (plus `receipt.deviceKey → device`).

**Status lifecycle**, updated in place on the one submission entity:
`queued → submitted → confirmed / failed` (via `updateEntity`).

**Ownership model** — the station is the immutable `$creator` of every entity (queries trust it via `.createdBy()`), and when a tx resolves the station mints a **receipt** and transfers `$owner` to the submitting user (`changeOwnership`). So the user owns their data; the attribution can't be spoofed.

**Durable queue + recovery** — a scheduled tx is written as a `queued` entity *before* its timer is armed; on boot the station re-queries `status="queued"` entities it created and re-arms or submits them. Failed submissions are kept longer with `extendEntity`.

**Numeric attributes** (`chainId`, `submitAfter`, `blockNumber`) enable range queries (e.g. `submitAfter <= now`).

### Ground station endpoints
- `GET /health`
- `GET /submissions` — local + Arkiv submission entities (`?query=` for a raw `arkiv_query`)
- `GET /devices` — registered device entities
- `GET /receipts?owner=0x…` — receipts owned by a user
- `GET /events` — SSE stream of submission updates

## Tech stack
TypeScript · pnpm + Turborepo · Hono (Node) · Next.js · viem · `@arkiv-network/sdk` 0.6.8 (Braga) · PlatformIO / Arduino-ESP32 · RadioLib · Iridium SBD · Vitest.

## Repo layout
- `packages/core` — chains, raw-tx signing, frame/message codecs, Arkiv client.
- `packages/ground-station` — Hono service: serial ingest, RPC submit, Arkiv lifecycle, queue recovery, SSE.
- `apps/dashboard` — Next.js operator dashboard (console, audit explorer, pitch).
- `firmware` — PlatformIO Arduino-ESP32 firmware.

## Setup

### 0. Hardware

Two ESP32 nodes are needed: a **device** (user/offline signer) and a **node** (satellite ground receiver) that plugs into the host running the ground station. Both build from the same `firmware/` project (`esp32dev` board) — see [`firmware/README.md`](firmware/README.md) for wiring pins.

**Device — user/offline signer** (`pio run -e user-device`)

| Part | Notes |
| --- | --- |
| ESP32 dev board | `esp32dev`, signs raw EVM tx offline |
| SSD1306 OLED | 128×64, I2C address `0x3C` |
| SX127x LoRa module | e.g. SX1276 / RFM95, + antenna for the LoRa path |
| Iridium SBD modem | e.g. RockBLOCK 9603 on UART2 (19200 baud), + antenna and sky visibility for the satellite path |
| USB cable | serial path + flashing |

**Node — satellite ground receiver** (`pio run -e ground-receiver`)

| Part | Notes |
| --- | --- |
| ESP32 dev board | `esp32dev`, polls the modem and forwards frames over USB serial |
| SSD1306 OLED | 128×64, I2C address `0x3C` |
| SX127x LoRa module | matching the device radio, + antenna |
| Iridium SBD modem | e.g. RockBLOCK 9603 on UART2 (19200 baud), + antenna and sky visibility |
| USB cable | connects to the host as `SERIAL_PORT_PATH` |
| Host computer | runs the Node ground station + dashboard |

The LoRa and Iridium radios are optional per transport: the serial path needs only the ESP32 + USB cable, the LoRa path needs the SX127x pair, and the satellite path needs both Iridium modems with airtime.

### 1. Install
```sh
pnpm install
```

### 2. Connect to Arkiv Braga
- Faucet (GLM for gas): https://braga.hoodi.arkiv.network/faucet/
- Explorer: https://explorer.braga.hoodi.arkiv.network/
- Data explorer (inspect entities): https://data.arkiv.network/

Fund the **ground-station** wallet with Braga GLM (it pays gas for entity writes) and the **device** wallet with Sepolia ETH (it pays gas for the relayed tx).

### 3. Environment
Create `.env` for the ground station:

| Var | Purpose | Default |
| --- | --- | --- |
| `GROUND_STATION_PRIVATE_KEY` | signs Arkiv entities (the station wallet) | — (required for writes) |
| `DEVICE_PRIVATE_KEY` | reference device signer | optional |
| `SEPOLIA_RPC_URL` | destination chain RPC | public node |
| `ARKIV_RPC_URL` | Arkiv Braga RPC | `https://braga.hoodi.arkiv.network/rpc` |
| `ARKIV_WS_URL` | Arkiv Braga WS | `wss://braga.hoodi.arkiv.network/rpc/ws` |
| `GROUND_STATION_PORT` | HTTP port | `8787` |
| `SERIAL_PORT_PATH` | radio receiver serial device | optional |
| `SERIAL_BAUD_RATE` | serial baud | `115200` |
| `AUDIT_EXPIRES_DAYS` | submission entity TTL | `30` |

Dashboard: set `NEXT_PUBLIC_GROUND_STATION_URL` to the ground-station URL.

### 4. Run
```sh
pnpm build
pnpm test          # unit tests
pnpm test:e2e      # full relay path
pnpm dev           # all services
# or individually
pnpm dev:ground-station
pnpm dev:dashboard
```

## Runtime constraints
- The ground station is a pure submitter: it never holds custody and never alters or re-signs the raw transaction.
- The device account pays gas on the destination chain; the station wallet pays gas for Arkiv writes.
- Firmware self-manages nonce offline, so device nonce state must stay aligned with chain state.
- Transaction ingress is framed serial data from the radio/satellite receiver — not HTTP.
- LoRa/SBD messages are MTU-capped; a signed tx may span many frames (reassembled with CRC16).
- Iridium SBD send/receive is implemented in firmware; real satellite operation needs active modems, airtime, and sky visibility.

## Team
- _Name · GitHub handle · wallet address_ (fill before submission)

## Demo
- _Deployed dashboard URL_ (fill before submission)