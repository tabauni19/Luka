package co.luka.finanzas.capture

import android.content.ComponentName
import android.content.Intent
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/** Puente JS ⇄ Kotlin. Ver src/native/autoCapture.ts para el lado web. */
@CapacitorPlugin(name = "AutoCapture")
class AutoCapturePlugin : Plugin() {

    override fun load() {
        PurchaseListenerService.onCaptured = {
            activity?.runOnUiThread { notifyListeners("captured", JSObject()) }
        }
    }

    private fun granted(): Boolean =
        NotificationManagerCompat.getEnabledListenerPackages(context).contains(context.packageName)

    @PluginMethod
    fun getStatus(call: PluginCall) {
        call.resolve(JSObject().apply {
            put("permissionGranted", granted())
            put("queued", CaptureQueue(context).size())
        })
    }

    @PluginMethod
    fun openPermissionSettings(call: PluginCall) {
        val intent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            // Android 11+: abre directamente el detalle de Luka cuando el sistema lo permite.
            putExtra(
                "android.provider.extra.NOTIFICATION_LISTENER_COMPONENT_NAME",
                ComponentName(context, PurchaseListenerService::class.java).flattenToString()
            )
        }
        context.startActivity(intent)
        call.resolve()
    }

    @PluginMethod
    fun setConfig(call: PluginCall) {
        val enabled = call.getBoolean("enabled", false) ?: false
        val sources = call.getArray("sources", JSArray())?.toList<String>()?.toSet() ?: emptySet()
        context.getSharedPreferences(PurchaseListenerService.PREFS, android.content.Context.MODE_PRIVATE).edit()
            .putBoolean(PurchaseListenerService.KEY_ENABLED, enabled)
            .putStringSet(PurchaseListenerService.KEY_SOURCES, sources)
            .apply()
        call.resolve()
    }

    @PluginMethod
    fun readQueue(call: PluginCall) {
        val arr = CaptureQueue(context).readAll()
        call.resolve(JSObject().apply { put("events", JSArray(arr.toString())) })
    }

    @PluginMethod
    fun ack(call: PluginCall) {
        val ids = call.getArray("ids", JSArray())?.toList<String>()?.toSet() ?: emptySet()
        CaptureQueue(context).remove(ids)
        call.resolve()
    }
}
