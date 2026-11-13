package co.luka.finanzas.capture

import java.text.Normalizer

/**
 * Extrae los datos de una compra desde el texto de una notificación.
 *
 * Kotlin puro (sin clases de Android) para poder probarlo en la JVM:
 *   cd android-parser-tests && gradle test
 *
 * IMPORTANTE: el formato exacto de las notificaciones de Google Wallet y de cada banco
 * no está documentado y cambia. Estas reglas cubren formatos típicos; hay que verificarlas
 * con notificaciones reales (ver docs/ANDROID.md).
 */
data class ParsedPurchase(
    val amount: Long?,        // pesos enteros (o unidades de la moneda, redondeadas)
    val currency: String?,    // "COP", "USD", "EUR" o null si no se pudo saber
    val merchant: String?,
    val cardLast4: String?,
    val declined: Boolean,
)

object NotificationParser {

    private val DECLINED = Regex(
        "\\b(rechazad[ao]|declinad[ao]|no (fue )?aprobad[ao]|no exitos[ao]|fallid[ao]|fondos insuficientes|saldo insuficiente|declined|denied|not approved|failed)\\b"
    )
    private val PURCHASE_HINT = Regex(
        "\\b(compra|compraste|pagaste|pago|transaccion|cargo|aprobad[ao]|paid|purchase|payment|debito|retiro)\\b"
    )
    // Moneda antes del número: "COP 23.500", "$23.500,00", "US$ 20.00", "USD 20"
    private val AMOUNT_PREFIX = Regex("(US\\$|USD|COP|EUR|€|\\$)\\s?(\\d{1,3}(?:[.,]\\d{3})+(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?)", RegexOption.IGNORE_CASE)
    // Moneda después del número: "23.500 COP", "23500 pesos"
    private val AMOUNT_SUFFIX = Regex("(\\d{1,3}(?:[.,]\\d{3})+(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?)\\s?(COP|USD|EUR|pesos)\\b", RegexOption.IGNORE_CASE)
    private val LAST4 = Regex("(?:\\*|•|·|x{2,}|terminada en|termina en|finalizada en|final|\\.{2,})\\s*(\\d{4})\\b", RegexOption.IGNORE_CASE)
    private val MERCHANT_EN = Regex("\\ben\\s+([A-Za-z0-9ÁÉÍÓÚÑáéíóúñ&'´.\\- ]{2,40}?)(?=\\s+\\d{1,2}:\\d{2}|\\s+el\\s+\\d|\\s+con\\b|\\s+por\\b|\\s+desde\\b|\\.\\s|\\.$|,|$)")
    private val GENERIC_TITLES = setOf("google wallet", "wallet", "google pay", "compra", "compra aprobada", "nueva compra", "transaccion", "bancolombia", "nu", "lulo bank", "nequi", "davivienda", "pago")

    fun normalize(s: String): String =
        Normalizer.normalize(s.lowercase(), Normalizer.Form.NFD).replace(Regex("\\p{M}+"), "")

    /** Convierte "23.500,00" / "23,500.00" / "23.500" / "20.00" a número. */
    fun parseNumber(raw: String): Double? {
        val s = raw.trim()
        val lastSep = maxOf(s.lastIndexOf('.'), s.lastIndexOf(','))
        if (lastSep < 0) return s.toDoubleOrNull()
        val decimals = s.length - lastSep - 1
        val hasBoth = s.contains('.') && s.contains(',')
        return if (decimals in 1..2 && (hasBoth || s.count { it == '.' || it == ',' } == 1 && decimals != 3)) {
            val intPart = s.substring(0, lastSep).replace(".", "").replace(",", "")
            "$intPart.${s.substring(lastSep + 1)}".toDoubleOrNull()
        } else {
            s.replace(".", "").replace(",", "").toDoubleOrNull()
        }
    }

    private fun currencyOf(token: String): String? = when (token.uppercase()) {
        "COP", "PESOS" -> "COP"
        // En apps colombianas "$" es pesos. Si el banco mostrara dólares usaría "US$" o "USD".
        "$" -> "COP"
        "US$", "USD" -> "USD"
        "EUR", "€" -> "EUR"
        else -> null
    }

    /**
     * @param isWallet true si la notificación viene de Google Wallet (su título suele ser el comercio).
     * @return null si no parece una compra (p. ej. promociones, recordatorios).
     */
    fun parse(title: String?, text: String?, isWallet: Boolean): ParsedPurchase? {
        val t = title?.trim().orEmpty()
        val body = text?.trim().orEmpty()
        val full = listOf(t, body).filter { it.isNotEmpty() }.joinToString(". ")
        if (full.isEmpty()) return null
        val norm = normalize(full)

        val declined = DECLINED.containsMatchIn(norm)

        var amount: Long? = null
        var currency: String? = null
        val pre = AMOUNT_PREFIX.find(full)
        val suf = AMOUNT_SUFFIX.find(full)
        val m = listOfNotNull(pre, suf).minByOrNull { it.range.first }
        if (m != null) {
            val (numRaw, cur) = if (m === pre) m.groupValues[2] to m.groupValues[1] else m.groupValues[1] to m.groupValues[2]
            parseNumber(numRaw)?.let { amount = Math.round(it) }
            currency = currencyOf(cur)
        }

        val looksLikePurchase = PURCHASE_HINT.containsMatchIn(norm) || (isWallet && amount != null) || declined
        if (!looksLikePurchase) return null
        if (amount == null && !isWallet && !declined) return null

        val last4 = LAST4.find(full)?.groupValues?.get(1)

        var merchant: String? = null
        if (isWallet && t.isNotEmpty() && normalize(t) !in GENERIC_TITLES && !AMOUNT_PREFIX.containsMatchIn(t)) {
            merchant = t
        }
        if (merchant == null) {
            merchant = MERCHANT_EN.find(body)?.groupValues?.get(1)?.trim()?.trimEnd('.', '-', ' ')
                ?.takeIf { it.isNotEmpty() && !it.matches(Regex("(?i)(tu|su) (cuenta|tarjeta).*")) }
        }

        return ParsedPurchase(amount, currency, merchant, last4, declined)
    }
}
