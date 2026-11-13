package co.luka.finanzas.capture

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * Cola persistente en un archivo privado de la app (files/capture-queue.json).
 * Sobrevive a que la app se cierre o el celular se reinicie. Solo guarda los campos
 * del movimiento: nada del texto completo de la notificación.
 *
 * La UI la lee al abrirse (readQueue), guarda los movimientos y después llama ack()
 * para borrar los que ya aplicó.
 */
class CaptureQueue(context: Context) {
    private val file = File(context.filesDir, "capture-queue.json")

    data class Event(
        val id: String,
        val app: String,
        val postedAt: Long,
        val amount: Long?,
        val currency: String?,
        val merchant: String?,
        val cardLast4: String?,
        val declined: Boolean,
    ) {
        fun toJson(): JSONObject = JSONObject().apply {
            put("id", id); put("app", app); put("postedAt", postedAt); put("declined", declined)
            amount?.let { put("amount", it) }
            currency?.let { put("currency", it) }
            merchant?.let { put("merchant", it) }
            cardLast4?.let { put("cardLast4", it) }
        }
    }

    @Synchronized
    fun readAll(): JSONArray = try {
        if (file.exists()) JSONArray(file.readText()) else JSONArray()
    } catch (e: Exception) {
        JSONArray()
    }

    @Synchronized
    fun append(e: Event) {
        val arr = readAll()
        for (i in 0 until arr.length()) if (arr.getJSONObject(i).optString("id") == e.id) return // ya está
        arr.put(e.toJson())
        // Tope de seguridad: no acumular indefinidamente si la app nunca se abre.
        val trimmed = if (arr.length() > 500) JSONArray().also { out -> for (i in arr.length() - 500 until arr.length()) out.put(arr.get(i)) } else arr
        writeAtomic(trimmed)
    }

    @Synchronized
    fun remove(ids: Set<String>) {
        val arr = readAll()
        val out = JSONArray()
        for (i in 0 until arr.length()) {
            val o = arr.getJSONObject(i)
            if (o.optString("id") !in ids) out.put(o)
        }
        writeAtomic(out)
    }

    @Synchronized
    fun size(): Int = readAll().length()

    private fun writeAtomic(arr: JSONArray) {
        val tmp = File(file.parentFile, "${file.name}.tmp")
        tmp.writeText(arr.toString())
        if (!tmp.renameTo(file)) {
            file.writeText(arr.toString())
            tmp.delete()
        }
    }
}
