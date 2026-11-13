import co.luka.finanzas.capture.NotificationParser
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.test.assertFalse

// Textos SIMULADOS con formatos típicos. Hay que confirmarlos con notificaciones reales.
class NotificationParserTest {
    @Test fun walletCompraCompleta() {
        val p = NotificationParser.parse("Juan Valdez Café", "$23.500,00 con Visa ••4321", isWallet = true)!!
        assertEquals(23500L, p.amount); assertEquals("COP", p.currency)
        assertEquals("Juan Valdez Café", p.merchant); assertEquals("4321", p.cardLast4); assertFalse(p.declined)
    }
    @Test fun walletConCOP() {
        val p = NotificationParser.parse("Éxito Unicentro", "COP 80.000 · Mastercard •••• 1234", isWallet = true)!!
        assertEquals(80000L, p.amount); assertEquals("COP", p.currency); assertEquals("1234", p.cardLast4)
    }
    @Test fun walletSinMonto() {
        val p = NotificationParser.parse("Tienda D1", "Pagaste con Visa ••9999", isWallet = true)!!
        assertNull(p.amount); assertEquals("Tienda D1", p.merchant); assertEquals("9999", p.cardLast4)
    }
    @Test fun walletEnDolares() {
        val p = NotificationParser.parse("Steam", "US$ 19.99 con Visa ••4321", isWallet = true)!!
        assertEquals(20L, p.amount); assertEquals("USD", p.currency)
    }
    @Test fun bancoEstiloBancolombia() {
        val p = NotificationParser.parse("Bancolombia", "Bancolombia le informa Compra por $80.000,00 en EXITO UNICENTRO 12:30. 13/11/2026 T.Cred *4321. Inquietudes al 018000931987", isWallet = false)!!
        assertEquals(80000L, p.amount); assertEquals("COP", p.currency)
        assertEquals("EXITO UNICENTRO", p.merchant); assertEquals("4321", p.cardLast4)
    }
    @Test fun compraRechazada() {
        val p = NotificationParser.parse("Compra rechazada", "Tu compra por $50.000 en FALABELLA fue rechazada. Tarjeta terminada en 4321", isWallet = false)!!
        assertTrue(p.declined); assertEquals(50000L, p.amount)
    }
    @Test fun walletDeclinada() {
        val p = NotificationParser.parse("Falabella", "Pago declinado · Visa ••4321", isWallet = true)!!
        assertTrue(p.declined)
    }
    @Test fun noEsCompra() {
        assertNull(NotificationParser.parse("Bancolombia", "Conoce los nuevos beneficios de tu tarjeta", isWallet = false))
        assertNull(NotificationParser.parse("Nu", "Tu extracto ya está disponible", isWallet = false))
    }
    @Test fun numeros() {
        assertEquals(23500.0, NotificationParser.parseNumber("23.500"))
        assertEquals(23500.0, NotificationParser.parseNumber("23.500,00"))
        assertEquals(23500.0, NotificationParser.parseNumber("23,500.00"))
        assertEquals(1250000.0, NotificationParser.parseNumber("1.250.000"))
        assertEquals(19.99, NotificationParser.parseNumber("19.99"))
    }
}
