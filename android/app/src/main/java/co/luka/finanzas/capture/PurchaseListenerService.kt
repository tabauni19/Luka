package co.luka.finanzas.capture

import android.app.Notification
import android.content.Context
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import java.security.MessageDigest

/**
 * Servicio que Android mantiene vivo aunque la interfaz de Luka esté cerrada,
 * siempre que el usuario haya concedido "Acceso a notificaciones".
 *
 * Por cada notificación nueva:
 *  1. Si el registro automático está apagado o la app no es una fuente elegida → se ignora
 *     al instante (no se lee ni se guarda nada).
 *  2. Se extraen monto, moneda, comercio, últimos 4 dígitos y si fue rechazada.
 *  3. Se agrega a la cola persistente. La app la sincroniza al abrirse.
 */
class PurchaseListenerService : NotificationListenerService() {

    companion object {
        const val PREFS = "luka_autocapture"
        const val KEY_ENABLED = "enabled"
        const val KEY_SOURCES = "sources"
        const val WALLET = "com.google.android.apps.walletnfcrel"
        private const val TAG = "LukaCapture"

        /** La UI se suscribe para sincronizar en vivo si está abierta. */
        @Volatile var onCaptured: (() -> Unit)? = null

        fun isEnabled(ctx: Context) = ctx.getSharedPreferences(PREFS, MODE_PRIVATE).getBoolean(KEY_ENABLED, false)
        fun sources(ctx: Context): Set<String> =
            ctx.getSharedPreferences(PREFS, MODE_PRIVATE).getStringSet(KEY_SOURCES, emptySet()) ?: emptySet()
    }

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        try {
            if (!isEnabled(this)) return
            val pkg = sbn.packageName
            if (pkg !in sources(this)) return
            val n = sbn.notification ?: return
            // Ignorar resúmenes de grupo y notificaciones persistentes (no son compras).
            if (n.flags and Notification.FLAG_GROUP_SUMMARY != 0) return
            if (n.flags and Notification.FLAG_ONGOING_EVENT != 0) return

            val extras = n.extras
            val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()
            val text = (extras.getCharSequence(Notification.EXTRA_BIG_TEXT) ?: extras.getCharSequence(Notification.EXTRA_TEXT))?.toString()

            val parsed = NotificationParser.parse(title, text, pkg == WALLET) ?: return

            val id = sha1("$pkg|${sbn.key}|${sbn.postTime}")
            CaptureQueue(this).append(
                CaptureQueue.Event(
                    id = id,
                    app = pkg,
                    postedAt = sbn.postTime,
                    amount = parsed.amount,
                    currency = parsed.currency,
                    merchant = parsed.merchant,
                    cardLast4 = parsed.cardLast4,
                    declined = parsed.declined,
                )
            )
            onCaptured?.invoke()
        } catch (e: Exception) {
            // Nunca tumbar el servicio por una notificación con formato raro. No se registra el texto.
            Log.w(TAG, "No se pudo procesar una notificación: ${e.javaClass.simpleName}")
        }
    }

    private fun sha1(s: String): String =
        MessageDigest.getInstance("SHA-1").digest(s.toByteArray()).joinToString("") { "%02x".format(it) }.take(24)
}
