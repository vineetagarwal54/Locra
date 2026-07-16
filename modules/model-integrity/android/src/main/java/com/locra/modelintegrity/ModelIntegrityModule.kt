package com.locra.modelintegrity

import android.net.Uri
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.BufferedInputStream
import java.io.File
import java.io.FileInputStream
import java.security.MessageDigest
import kotlin.coroutines.coroutineContext
import kotlin.math.max
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext

class ModelIntegrityModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("LocraModelIntegrity")
    Events("onProgress")

    AsyncFunction("verifyFile") Coroutine {
        requestId: String,
        fileUri: String,
        expectedSha256: String,
      ->
      withContext(Dispatchers.IO) {
        hashMatches(requestId, fileUri, expectedSha256)
      }
    }
  }

  private suspend fun hashMatches(
    requestId: String,
    fileUri: String,
    expectedSha256: String,
  ): Boolean {
    return try {
      val file = resolveFile(fileUri)
      if (!file.isFile) return false
      val totalBytes = file.length()
      val digest = MessageDigest.getInstance("SHA-256")
      val buffer = ByteArray(BUFFER_SIZE_BYTES)
      var bytesRead = 0L
      var bytesSinceProgress = 0L
      BufferedInputStream(FileInputStream(file), BUFFER_SIZE_BYTES).use { input ->
        while (true) {
          coroutineContext.ensureActive()
          val count = input.read(buffer)
          if (count < 0) break
          if (count == 0) continue
          digest.update(buffer, 0, count)
          bytesRead += count
          bytesSinceProgress += count
          if (bytesSinceProgress >= PROGRESS_INTERVAL_BYTES) {
            emitProgress(requestId, bytesRead, totalBytes)
            bytesSinceProgress = 0L
          }
        }
      }
      emitProgress(requestId, bytesRead, totalBytes)
      bytesRead == totalBytes && digest.digest().toHex() == expectedSha256.trim().lowercase()
    } catch (_: Exception) {
      false
    }
  }

  private fun emitProgress(requestId: String, bytesRead: Long, totalBytes: Long) {
    sendEvent(
      "onProgress",
      mapOf(
        "requestId" to requestId,
        "bytesRead" to bytesRead.toDouble(),
        "totalBytes" to totalBytes.toDouble(),
        "progress" to bytesRead.toDouble() / max(1L, totalBytes).toDouble(),
      ),
    )
  }

  private fun resolveFile(fileUri: String): File {
    if (!fileUri.startsWith("file://")) return File(fileUri)
    val path = Uri.parse(fileUri).path ?: throw IllegalArgumentException("Invalid file URI")
    return File(path)
  }

  companion object {
    private const val BUFFER_SIZE_BYTES = 1024 * 1024
    private const val PROGRESS_INTERVAL_BYTES = 4L * 1024L * 1024L
  }
}

private fun ByteArray.toHex(): String = joinToString(separator = "") { byte ->
  ((byte.toInt() and 0xff) + 0x100).toString(radix = 16).substring(startIndex = 1)
}
