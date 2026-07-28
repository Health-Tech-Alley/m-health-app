/**
 * IEEE float16 encode/decode for pack vectors (little-endian).
 */

export function float32ArrayToFloat16Buffer(values: number[]): Uint8Array {
  const out = new Uint8Array(values.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < values.length; i++) {
    view.setUint16(i * 2, float32ToFloat16Bits(values[i]), true);
  }
  return out;
}

export function float16BufferToFloat32Array(buf: Uint8Array | ArrayBuffer): number[] {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const n = Math.floor(u8.byteLength / 2);
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    out[i] = float16BitsToFloat32(view.getUint16(i * 2, true));
  }
  return out;
}

function float32ToFloat16Bits(value: number): number {
  const f32 = new Float32Array(1);
  const u32 = new Uint32Array(f32.buffer);
  f32[0] = value;
  const x = u32[0];
  const sign = (x >>> 16) & 0x8000;
  let exp = ((x >>> 23) & 0xff) - 127 + 15;
  let mant = x & 0x7fffff;

  if (exp <= 0) {
    if (exp < -10) return sign;
    mant = (mant | 0x800000) >>> (1 - exp);
    return sign | ((mant + 0x1000) >>> 13);
  }
  if (exp >= 0x1f) {
    // Inf / NaN
    if (mant !== 0) return sign | 0x7e00;
    return sign | 0x7c00;
  }
  return sign | (exp << 10) | ((mant + 0x1000) >>> 13);
}

function float16BitsToFloat32(h: number): number {
  const sign = (h & 0x8000) << 16;
  let exp = (h >> 10) & 0x1f;
  let mant = h & 0x3ff;
  const f32 = new Float32Array(1);
  const u32 = new Uint32Array(f32.buffer);

  if (exp === 0) {
    if (mant === 0) {
      u32[0] = sign;
      return f32[0];
    }
    exp = 1;
    while ((mant & 0x400) === 0) {
      mant <<= 1;
      exp--;
    }
    mant &= 0x3ff;
    const e = exp - 15 + 127;
    u32[0] = sign | (e << 23) | (mant << 13);
    return f32[0];
  }
  if (exp === 0x1f) {
    u32[0] = sign | 0x7f800000 | (mant << 13);
    return f32[0];
  }
  const e = exp - 15 + 127;
  u32[0] = sign | (e << 23) | (mant << 13);
  return f32[0];
}
