import { float16BufferToFloat32Array, float32ArrayToFloat16Buffer } from './float16';

describe('float16 pack vectors', () => {
  it('round-trips approximate values', () => {
    const input = [0, 1, -1, 0.5, -0.25, 3.14, 0.0001];
    const buf = float32ArrayToFloat16Buffer(input);
    expect(buf.byteLength).toBe(input.length * 2);
    const out = float16BufferToFloat32Array(buf);
    expect(out).toHaveLength(input.length);
    for (let i = 0; i < input.length; i++) {
      expect(out[i]).toBeCloseTo(input[i], 2);
    }
  });

  it('encodes 768-d zero vector', () => {
    const zeros = new Array(768).fill(0);
    const buf = float32ArrayToFloat16Buffer(zeros);
    expect(buf.byteLength).toBe(1536);
    const out = float16BufferToFloat32Array(buf);
    expect(out.every((v) => v === 0)).toBe(true);
  });
});
