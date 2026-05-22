import { bytesToHex, type Hex, hexToBytes, numberToBytes } from "viem";

export const ESPRESSO_MAGIC = 0xe5;
export const FRAME_VERSION = 1;
export const DEFAULT_RADIO_MTU = 192;
export const FRAME_HEADER_BYTES = 14;

export type Frame = {
  magic: typeof ESPRESSO_MAGIC;
  version: typeof FRAME_VERSION;
  messageId: number;
  index: number;
  total: number;
  payload: Uint8Array;
  crc16: number;
};

export type ReassembledMessage = {
  messageId: number;
  payload: Uint8Array;
};

export function crc16Ccitt(bytes: Uint8Array): number {
  let crc = 0xffff;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000) !== 0 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc;
}

function writeUint16(target: Uint8Array, offset: number, value: number): void {
  target[offset] = (value >> 8) & 0xff;
  target[offset + 1] = value & 0xff;
}

function readUint16(source: Uint8Array, offset: number): number {
  return ((source[offset] ?? 0) << 8) | (source[offset + 1] ?? 0);
}

function writeUint32(target: Uint8Array, offset: number, value: number): void {
  target[offset] = (value >>> 24) & 0xff;
  target[offset + 1] = (value >>> 16) & 0xff;
  target[offset + 2] = (value >>> 8) & 0xff;
  target[offset + 3] = value & 0xff;
}

function readUint32(source: Uint8Array, offset: number): number {
  return (
    (((source[offset] ?? 0) << 24) |
      ((source[offset + 1] ?? 0) << 16) |
      ((source[offset + 2] ?? 0) << 8) |
      (source[offset + 3] ?? 0)) >>>
    0
  );
}

export function encodeFrame(frame: Omit<Frame, "magic" | "version" | "crc16">): Uint8Array {
  if (frame.index >= frame.total) throw new Error("Frame index must be less than total");
  const out = new Uint8Array(FRAME_HEADER_BYTES + frame.payload.length);
  out[0] = ESPRESSO_MAGIC;
  out[1] = FRAME_VERSION;
  writeUint32(out, 2, frame.messageId);
  writeUint16(out, 6, frame.index);
  writeUint16(out, 8, frame.total);
  writeUint16(out, 10, frame.payload.length);
  out.set(frame.payload, FRAME_HEADER_BYTES);
  writeUint16(out, 12, crc16Ccitt(out));
  return out;
}

export function decodeFrame(bytes: Uint8Array): Frame {
  if (bytes.length < FRAME_HEADER_BYTES) throw new Error("Frame too short");
  if (bytes[0] !== ESPRESSO_MAGIC) throw new Error("Invalid Espresso frame magic");
  if (bytes[1] !== FRAME_VERSION) throw new Error("Unsupported Espresso frame version");
  const payloadLength = readUint16(bytes, 10);
  if (bytes.length !== FRAME_HEADER_BYTES + payloadLength) throw new Error("Frame length mismatch");
  const expectedCrc = readUint16(bytes, 12);
  const crcInput = new Uint8Array(bytes);
  crcInput[12] = 0;
  crcInput[13] = 0;
  const actualCrc = crc16Ccitt(crcInput);
  if (actualCrc !== expectedCrc) throw new Error("Frame CRC mismatch");
  return {
    magic: ESPRESSO_MAGIC,
    version: FRAME_VERSION,
    messageId: readUint32(bytes, 2),
    index: readUint16(bytes, 6),
    total: readUint16(bytes, 8),
    payload: bytes.slice(FRAME_HEADER_BYTES),
    crc16: expectedCrc,
  };
}

export function chunkPayload(payload: Uint8Array, messageId: number, mtu = DEFAULT_RADIO_MTU): Uint8Array[] {
  const maxPayload = mtu - FRAME_HEADER_BYTES;
  if (maxPayload <= 0) throw new Error("MTU must leave room for Espresso frame header");
  const total = Math.ceil(payload.length / maxPayload) || 1;
  if (total > 65_535) throw new Error("Payload requires too many frames");
  return Array.from({ length: total }, (_, index) =>
    encodeFrame({
      messageId,
      index,
      total,
      payload: payload.slice(index * maxPayload, (index + 1) * maxPayload),
    }),
  );
}

export function chunkHexPayload(payload: Hex, messageId: number, mtu = DEFAULT_RADIO_MTU): Uint8Array[] {
  return chunkPayload(hexToBytes(payload), messageId, mtu);
}

export class FrameReassembler {
  readonly #messages = new Map<number, { total: number; chunks: Map<number, Uint8Array> }>();

  push(frameBytes: Uint8Array): ReassembledMessage | undefined {
    const frame = decodeFrame(frameBytes);
    const current = this.#messages.get(frame.messageId) ?? {
      total: frame.total,
      chunks: new Map<number, Uint8Array>(),
    };
    if (current.total !== frame.total) throw new Error("Frame total changed for message");
    current.chunks.set(frame.index, frame.payload);
    this.#messages.set(frame.messageId, current);
    if (current.chunks.size !== current.total) return undefined;

    const parts = Array.from({ length: current.total }, (_, index) => {
      const chunk = current.chunks.get(index);
      if (!chunk) throw new Error(`Missing frame ${index}`);
      return chunk;
    });
    const size = parts.reduce((sum, part) => sum + part.length, 0);
    const payload = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) {
      payload.set(part, offset);
      offset += part.length;
    }
    this.#messages.delete(frame.messageId);
    return { messageId: frame.messageId, payload };
  }
}

export function makeMessageId(seed: Uint8Array = numberToBytes(Date.now(), { size: 8 })): number {
  return crc16Ccitt(seed) | (crc16Ccitt(seed.reverse()) << 16);
}

export function payloadToFrameHex(frames: Uint8Array[]): Hex[] {
  return frames.map((frame) => bytesToHex(frame));
}
