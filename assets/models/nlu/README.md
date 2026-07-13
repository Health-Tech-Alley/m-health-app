# On-device NLU embedder assets (plan 35)

## Primary ship files

| File | Format | Size | Dim | Status |
|------|--------|------|-----|--------|
| **`mdbr-leaf-ir.tflite`** | TFLite **float32** | ~92 MB | **768** | **Validated** vs ST (cos≈1.0, ranking 1.0) |
| **`mdbr-leaf-ir-int8.tflite`** | TFLite **weight-only INT8** | ~59 MB | **768** | **Validated** (cos≈0.9998, ranking 1.0); 37 large int8 weight tensors via `ai_edge_quantizer` `weight_only_wi8_afp32` |

Also: `mdbr-leaf-ir-fp32.tflite` (same bytes as float32 primary).

## Also produced

| File | Notes |
|------|--------|
| `mdbr-leaf-ir-fp32.onnx` | FP32 ONNX export (~92 MB) |
| `mdbr-leaf-ir-int8.onnx` | **Weight INT8** ONNX (~23 MB), validation **PASS** (smaller than TFLite WI8; needs ORT to run in-app) |
| `tokenizer/` | HF tokenizer + ST module configs |
| `validation-report.json` | Full gates |

## Query prefix (required)

```
Represent this sentence for searching relevant passages: <user text>
```

Documents / tool descriptions: **no** prefix.

## Runtime

- App target: **`react-native-fast-tflite`** (same as Alert ML).
- Prefer **`mdbr-leaf-ir-int8.tflite`** for size; fall back to `mdbr-leaf-ir.tflite` if needed.
- ONNX INT8 is **not** loadable without adding ONNX Runtime RN.

## Notes

- FP16 TFLite failed at runtime (`GATHER` + FLOAT16).
- onnx2tf integer quant path did not emit a real INT8 `.tflite` (FP32 alias only).
- True weight-INT8 TFLite produced with **ai_edge_quantizer** weight-only INT8 on the validated FP32 TFLite (no calibration). Embeddings/ops stay float; MatMul weights are int8 + dequant → ~1.5× smaller than FP32, quality nearly identical to ST.

## Regenerate

```bash
cd planning/python-testing
source .venv/bin/activate
python export_leaf_ir_tflite.py
# weight-only INT8 from validated FP32:
python -c "from ai_edge_quantizer import quantizer, recipe; q=quantizer.Quantizer('.../mdbr-leaf-ir.tflite'); q.load_quantization_recipe(recipe.weight_only_wi8_afp32()); q.quantize(serialize_to_path='.../mdbr-leaf-ir-int8.tflite')"
```

Source model: `MongoDB/mdbr-leaf-ir` (+ optional overlay `planning/model.safetensors`).
