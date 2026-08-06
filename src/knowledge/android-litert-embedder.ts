import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

type TensorInfo = { name: string; dataType: string; shape: number[] };

export type AndroidLiteRtModelHandle = {
  readonly inputs: readonly TensorInfo[];
  readonly outputs: readonly TensorInfo[];
  run(input: ArrayBuffer[]): Promise<ArrayBuffer[]>;
  dispose(): void;
};

type NativeTensorInfo = TensorInfo & {
  index?: number;
  byteSize?: number;
};

type NativeLoadResult = {
  generation: number;
  inputs: NativeTensorInfo[];
  outputs: NativeTensorInfo[];
};

type NativeLiteRtEmbedderModule = {
  loadModel(path: string): Promise<NativeLoadResult>;
  runModel(
    generation: number,
    inputIds: number[],
    attentionMask: number[],
  ): Promise<number[]>;
  disposeModel(generation: number): void;
};

let resolved = false;
let nativeModule: NativeLiteRtEmbedderModule | null = null;

function resolveModule(): NativeLiteRtEmbedderModule | null {
  if (resolved) return nativeModule;
  resolved = true;
  const mod =
    requireOptionalNativeModule<NativeLiteRtEmbedderModule>('LiteRtEmbedder');
  if (
    mod &&
    typeof mod.loadModel === 'function' &&
    typeof mod.runModel === 'function' &&
    typeof mod.disposeModel === 'function'
  ) {
    nativeModule = mod;
  }
  return nativeModule;
}

export function isAndroidLiteRtEmbedderAvailable(): boolean {
  return Platform.OS === 'android' && resolveModule() !== null;
}

export async function loadAndroidLiteRtEmbedderModel(
  path: string,
): Promise<AndroidLiteRtModelHandle> {
  if (Platform.OS !== 'android') {
    throw new Error('LiteRtEmbedder is Android-only');
  }
  const mod = resolveModule();
  if (!mod) {
    throw new Error('LiteRtEmbedder Expo module unavailable');
  }

  const loaded = await mod.loadModel(path);
  const generation = loaded.generation;
  const inputs = normalizeTensors(loaded.inputs, 'input');
  const outputs = normalizeTensors(loaded.outputs, 'output');
  let disposed = false;

  return {
    inputs,
    outputs,
    async run(buffers: ArrayBuffer[]): Promise<ArrayBuffer[]> {
      if (disposed) throw new Error('LiteRtEmbedder model is disposed');
      const inputIds = decodeTensorBuffer(inputs, buffers, 'input_ids');
      const attentionMask = decodeTensorBuffer(
        inputs,
        buffers,
        'attention_mask',
      );
      const output = await mod.runModel(generation, inputIds, attentionMask);
      return [floatArrayToBuffer(output)];
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      mod.disposeModel(generation);
    },
  };
}

function normalizeTensors(
  tensors: NativeTensorInfo[] | undefined,
  label: string,
): TensorInfo[] {
  if (!Array.isArray(tensors) || tensors.length === 0) {
    throw new Error(`LiteRtEmbedder missing ${label} metadata`);
  }
  return tensors.map((tensor, index) => {
    if (!tensor || typeof tensor.name !== 'string') {
      throw new Error(`LiteRtEmbedder invalid ${label} tensor ${index}`);
    }
    if (typeof tensor.dataType !== 'string') {
      throw new Error(`LiteRtEmbedder invalid ${label} tensor type ${index}`);
    }
    if (!Array.isArray(tensor.shape)) {
      throw new Error(`LiteRtEmbedder invalid ${label} tensor shape ${index}`);
    }
    return {
      name: tensor.name,
      dataType: tensor.dataType.toLowerCase(),
      shape: tensor.shape.map((dim) => Number(dim)),
    };
  });
}

function decodeTensorBuffer(
  inputs: readonly TensorInfo[],
  buffers: readonly ArrayBuffer[],
  name: 'input_ids' | 'attention_mask',
): number[] {
  const index = inputs.findIndex((tensor) => tensor.name === name);
  if (index < 0) throw new Error(`LiteRtEmbedder missing ${name} metadata`);
  const tensor = inputs[index];
  const buffer = buffers[index];
  if (!buffer) throw new Error(`LiteRtEmbedder missing ${name} buffer`);

  const expectedValues = elementCount(tensor.shape);
  const expectedBytes = expectedValues * 8;
  if (buffer.byteLength !== expectedBytes) {
    throw new Error(
      `LiteRtEmbedder ${name} buffer has ${buffer.byteLength} bytes; expected ${expectedBytes}`,
    );
  }

  const view = new DataView(buffer);
  const values = new Array<number>(expectedValues);
  for (let i = 0; i < expectedValues; i++) {
    const low = view.getUint32(i * 8, true);
    const high = view.getInt32(i * 8 + 4, true);
    const value = high * 0x100000000 + low;
    if (!Number.isSafeInteger(value)) {
      throw new Error(`LiteRtEmbedder ${name} contains an unsafe integer`);
    }
    values[i] = value;
  }
  return values;
}

function elementCount(shape: readonly number[]): number {
  let count = 1;
  for (const dim of shape) {
    if (Number.isFinite(dim) && dim > 0) count *= dim;
  }
  return Math.max(count, 1);
}

function floatArrayToBuffer(values: readonly number[]): ArrayBuffer {
  if (values.length !== 768) {
    throw new Error(`LiteRtEmbedder returned ${values.length} floats`);
  }
  for (const value of values) {
    if (!Number.isFinite(value)) {
      throw new Error('LiteRtEmbedder returned non-finite floats');
    }
  }
  const floats = Float32Array.from(values);
  return floats.buffer.slice(
    floats.byteOffset,
    floats.byteOffset + floats.byteLength,
  );
}
