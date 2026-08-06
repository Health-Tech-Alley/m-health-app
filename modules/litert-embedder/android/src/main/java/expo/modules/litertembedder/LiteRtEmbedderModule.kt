package expo.modules.litertembedder

import android.content.pm.ApplicationInfo
import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.tensorflow.lite.DataType
import org.tensorflow.lite.Interpreter
import org.tensorflow.lite.Tensor
import java.io.File
import java.io.FileInputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.MappedByteBuffer
import java.nio.channels.FileChannel

class LiteRtEmbedderModule : Module() {
  private val lock = Any()
  private var loaded: LoadedModel? = null
  private var nextGeneration = 1

  override fun definition() = ModuleDefinition {
    Name("LiteRtEmbedder")

    AsyncFunction("loadModel") { path: String ->
      loadModel(path)
    }

    AsyncFunction("runModel") { generation: Int, inputIds: LongArray, attentionMask: LongArray ->
      runModel(generation, inputIds, attentionMask)
    }

    Function("disposeModel") { generation: Int ->
      disposeModel(generation)
    }
  }

  private fun loadModel(path: String): Map<String, Any?> {
    synchronized(lock) {
      loaded?.let { state ->
        logDev("load reused generation=${state.generation}")
        return state.toResult(runtimeVersion())
      }

      val file = File(path)
      if (!file.isFile) {
        throw IllegalArgumentException("LiteRtEmbedder model file is missing")
      }

      var stream: FileInputStream? = null
      var channel: FileChannel? = null
      var mappedBuffer: MappedByteBuffer? = null
      var interpreter: Interpreter? = null
      var stage = "model mapping"

      try {
        stream = FileInputStream(file)
        channel = stream.channel
        val mappedBytes = channel.size()
        if (mappedBytes <= 0L) {
          throw IllegalStateException("LiteRtEmbedder model file is empty")
        }

        mappedBuffer = channel.map(FileChannel.MapMode.READ_ONLY, 0, mappedBytes)
        logDev(
          "LITERT_EXPO_MAPPED_BUFFER path executing mappedBytes=$mappedBytes runtime=${runtimeVersion() ?: "unknown"}"
        )

        stage = "interpreter creation"
        interpreter = Interpreter(mappedBuffer)

        stage = "metadata validation"
        val inputs = readTensorMetadata(interpreter, input = true)
        val outputs = readTensorMetadata(interpreter, input = false)
        val outputIndex = validateMetadata(inputs, outputs)

        val generation = nextGeneration++
        val state = LoadedModel(
          generation = generation,
          interpreter = interpreter,
          modelBuffer = mappedBuffer,
          stream = stream,
          channel = channel,
          mappedBytes = mappedBytes,
          inputs = inputs,
          outputs = outputs,
          outputIndex = outputIndex
        )
        loaded = state
        logDev(
          "load ok generation=$generation mappedBytes=$mappedBytes inputs=${describe(inputs)} outputs=${describe(outputs)}"
        )
        return state.toResult(runtimeVersion())
      } catch (err: Throwable) {
        logDev("load failed stage=$stage error=${err.safeMessage()}")
        closePartial(interpreter, channel, stream)
        throw RuntimeException("LiteRtEmbedder $stage failed: ${err.message}", err)
      }
    }
  }

  private fun runModel(
    generation: Int,
    inputIds: LongArray,
    attentionMask: LongArray
  ): FloatArray {
    synchronized(lock) {
      val state = loaded ?: throw IllegalStateException("LiteRtEmbedder model is not loaded")
      if (state.generation != generation) {
        throw IllegalStateException("LiteRtEmbedder stale model handle")
      }

      var stage = "input preparation"
      try {
        if (inputIds.size != SEQUENCE_LENGTH || attentionMask.size != SEQUENCE_LENGTH) {
          throw IllegalArgumentException(
            "LiteRtEmbedder expected two int64 [$SEQUENCE_LENGTH] inputs"
          )
        }

        val inputObjects = arrayOfNulls<Any>(state.inputs.size)
        for (meta in state.inputs) {
          inputObjects[meta.index] = packInt64Input(
            if (meta.name == ATTENTION_MASK_NAME) attentionMask else inputIds
          )
        }
        logDev(
          "input preparation ok generation=$generation inputIdsBytes=${SEQUENCE_LENGTH * INT64_BYTES} attentionMaskBytes=${SEQUENCE_LENGTH * INT64_BYTES}"
        )

        stage = "invocation"
        val output = Array(1) { FloatArray(EMBEDDING_DIMENSIONS) }
        state.interpreter.runForMultipleInputsOutputs(
          inputObjects.requireNoNulls(),
          mutableMapOf<Int, Any>(state.outputIndex to output)
        )

        stage = "output validation"
        val vector = output[0]
        val finiteCount = countFinite(vector)
        logDev(
          "invoke ok generation=$generation outputCount=${vector.size} finiteCount=$finiteCount"
        )
        if (vector.size != EMBEDDING_DIMENSIONS) {
          throw IllegalStateException("LiteRtEmbedder returned ${vector.size} floats")
        }
        if (finiteCount != EMBEDDING_DIMENSIONS) {
          throw IllegalStateException("LiteRtEmbedder returned non-finite floats")
        }
        return vector
      } catch (err: Throwable) {
        logDev("run failed stage=$stage generation=$generation error=${err.safeMessage()}")
        throw RuntimeException("LiteRtEmbedder $stage failed: ${err.message}", err)
      }
    }
  }

  private fun disposeModel(generation: Int) {
    synchronized(lock) {
      val state = loaded ?: return
      if (state.generation != generation) return
      loaded = null
      closeLoaded(state)
      logDev("disposed generation=$generation")
    }
  }

  private fun readTensorMetadata(
    interpreter: Interpreter,
    input: Boolean
  ): List<TensorMetadata> {
    val count = if (input) interpreter.inputTensorCount else interpreter.outputTensorCount
    return (0 until count).map { index ->
      val tensor = if (input) interpreter.getInputTensor(index) else interpreter.getOutputTensor(index)
      tensor.toMetadata(index)
    }
  }

  private fun validateMetadata(
    inputs: List<TensorMetadata>,
    outputs: List<TensorMetadata>
  ): Int {
    val inputIds = inputs.firstOrNull { it.name == INPUT_IDS_NAME }
      ?: throw IllegalStateException("LiteRtEmbedder missing input_ids tensor")
    val attentionMask = inputs.firstOrNull { it.name == ATTENTION_MASK_NAME }
      ?: throw IllegalStateException("LiteRtEmbedder missing attention_mask tensor")
    validateInput(inputIds)
    validateInput(attentionMask)

    val output = outputs.firstOrNull { it.name == OUTPUT_NAME }
      ?: throw IllegalStateException("LiteRtEmbedder missing sentence_embedding tensor")
    if (output.dataType != "float32") {
      throw IllegalStateException("LiteRtEmbedder output type ${output.dataType}; expected float32")
    }
    if (!output.shape.contentEquals(intArrayOf(1, EMBEDDING_DIMENSIONS))) {
      throw IllegalStateException("LiteRtEmbedder output shape ${output.shapeText()}; expected [1,$EMBEDDING_DIMENSIONS]")
    }
    return output.index
  }

  private fun validateInput(meta: TensorMetadata) {
    if (meta.dataType != "int64") {
      throw IllegalStateException("LiteRtEmbedder input ${meta.name} type ${meta.dataType}; expected int64")
    }
    if (!meta.shape.contentEquals(intArrayOf(1, SEQUENCE_LENGTH))) {
      throw IllegalStateException("LiteRtEmbedder input ${meta.name} shape ${meta.shapeText()}; expected [1,$SEQUENCE_LENGTH]")
    }
    if (meta.byteSize != SEQUENCE_LENGTH * INT64_BYTES) {
      throw IllegalStateException("LiteRtEmbedder input ${meta.name} bytes ${meta.byteSize}; expected ${SEQUENCE_LENGTH * INT64_BYTES}")
    }
  }

  private fun packInt64Input(values: LongArray): ByteBuffer {
    val buffer = ByteBuffer.allocateDirect(values.size * INT64_BYTES).order(ByteOrder.nativeOrder())
    val longs = buffer.asLongBuffer()
    longs.put(values)
    buffer.rewind()
    return buffer
  }

  private fun Tensor.toMetadata(index: Int): TensorMetadata {
    return TensorMetadata(
      index = index,
      name = name(),
      dataType = dataTypeName(dataType()),
      shape = shape(),
      byteSize = numBytes()
    )
  }

  private fun dataTypeName(dataType: DataType): String {
    return dataType.name.lowercase()
  }

  private fun closeLoaded(state: LoadedModel) {
    var failure: Throwable? = null
    try {
      state.interpreter.close()
    } catch (err: Throwable) {
      failure = err
    }
    try {
      state.channel.close()
    } catch (err: Throwable) {
      if (failure == null) failure = err
    }
    try {
      state.stream.close()
    } catch (err: Throwable) {
      if (failure == null) failure = err
    }
    failure?.let {
      logDev("dispose failed error=${it.safeMessage()}")
      throw RuntimeException("LiteRtEmbedder disposal failed: ${it.message}", it)
    }
  }

  private fun closePartial(
    interpreter: Interpreter?,
    channel: FileChannel?,
    stream: FileInputStream?
  ) {
    try {
      interpreter?.close()
      channel?.close()
      stream?.close()
    } catch (err: Throwable) {
      logDev("partial cleanup failed error=${err.safeMessage()}")
    }
  }

  private fun LoadedModel.toResult(version: String?): Map<String, Any?> {
    return mapOf(
      "generation" to generation,
      "mappedBytes" to mappedBytes,
      "runtimeVersion" to version,
      "inputs" to inputs.map { it.toMap() },
      "outputs" to outputs.map { it.toMap() }
    )
  }

  private fun TensorMetadata.toMap(): Map<String, Any> {
    return mapOf(
      "index" to index,
      "name" to name,
      "dataType" to dataType,
      "shape" to shape.toList(),
      "byteSize" to byteSize
    )
  }

  private fun describe(tensors: List<TensorMetadata>): String {
    return tensors.joinToString(";") {
      "#${it.index}:${it.name}:${it.dataType}:${it.shapeText()}:bytes=${it.byteSize}"
    }
  }

  private fun TensorMetadata.shapeText(): String {
    return shape.joinToString(prefix = "[", postfix = "]")
  }

  private fun runtimeVersion(): String? {
    return try {
      val klass = Class.forName("org.tensorflow.lite.TensorFlowLite")
      val method = runCatching { klass.getMethod("runtimeVersion") }
        .getOrElse { klass.getMethod("version") }
      method.invoke(null) as? String
    } catch (_: Throwable) {
      null
    }
  }

  private fun countFinite(values: FloatArray): Int {
    var count = 0
    for (value in values) {
      if (!value.isNaN() && !value.isInfinite()) count += 1
    }
    return count
  }

  private fun Throwable.safeMessage(): String {
    return "${javaClass.simpleName}: ${message ?: "no message"}"
  }

  private fun logDev(message: String) {
    val context = appContext.reactContext ?: return
    val debuggable = (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
    if (debuggable) {
      Log.d(TAG, message)
    }
  }

  private data class LoadedModel(
    val generation: Int,
    val interpreter: Interpreter,
    val modelBuffer: MappedByteBuffer,
    val stream: FileInputStream,
    val channel: FileChannel,
    val mappedBytes: Long,
    val inputs: List<TensorMetadata>,
    val outputs: List<TensorMetadata>,
    val outputIndex: Int
  )

  private data class TensorMetadata(
    val index: Int,
    val name: String,
    val dataType: String,
    val shape: IntArray,
    val byteSize: Int
  ) {
    override fun equals(other: Any?): Boolean {
      if (this === other) return true
      if (javaClass != other?.javaClass) return false
      other as TensorMetadata
      return index == other.index &&
        name == other.name &&
        dataType == other.dataType &&
        shape.contentEquals(other.shape) &&
        byteSize == other.byteSize
    }

    override fun hashCode(): Int {
      var result = index
      result = 31 * result + name.hashCode()
      result = 31 * result + dataType.hashCode()
      result = 31 * result + shape.contentHashCode()
      result = 31 * result + byteSize
      return result
    }
  }

  private companion object {
    private const val TAG = "LiteRtEmbedder"
    private const val INPUT_IDS_NAME = "input_ids"
    private const val ATTENTION_MASK_NAME = "attention_mask"
    private const val OUTPUT_NAME = "sentence_embedding"
    private const val SEQUENCE_LENGTH = 512
    private const val EMBEDDING_DIMENSIONS = 768
    private const val INT64_BYTES = 8
  }
}
