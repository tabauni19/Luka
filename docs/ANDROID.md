# Luka en Android: registro automático de compras

## Qué hay

| Pieza | Archivo | Qué hace |
|---|---|---|
| Servicio | `android/app/src/main/java/co/luka/finanzas/capture/PurchaseListenerService.kt` | `NotificationListenerService`. Android lo mantiene vivo aunque Luka esté cerrada. Ignora todo lo que no venga de las fuentes elegidas. |
| Parser | `.../capture/NotificationParser.kt` | Kotlin puro. Saca monto, moneda, comercio, últimos 4 dígitos y si la compra fue rechazada. |
| Cola | `.../capture/CaptureQueue.kt` | Archivo JSON privado de la app (`files/capture-queue.json`). Sobrevive a cierres y reinicios. Solo guarda los campos del movimiento. |
| Puente | `.../capture/AutoCapturePlugin.kt` + `src/native/autoCapture.ts` | Plugin de Capacitor: estado del permiso, abrir ajustes, fuentes, leer la cola y confirmar (`ack`). |
| Reglas | `src/domain/capture.ts` | Decide si cada compra se guarda sola, queda «Por revisar», es duplicada o se descarta (rechazada). Probado en `tests/capture.test.ts`. |

Flujo: notificación → servicio (filtra fuente) → parser → cola → al abrir Luka: `readQueue` → `processCaptures` → se guarda en IndexedDB en una sola transacción → `ack` borra de la cola. Si la app muere a mitad, los eventos siguen en la cola y no se duplican porque cada id queda marcado como procesado.

## Qué se probó y qué NO

- ✅ Parser Kotlin en la JVM con textos **simulados** (`cd android-parser-tests && gradle test`, 9 pruebas).
- ✅ Reglas de guardado/revisión/duplicados/rechazadas en TypeScript con notificaciones **simuladas** (`npm test`).
- ✅ En el navegador, con `npm run dev`, Ajustes → Registro automático tiene botones para simular los cuatro casos.
- ❌ **No se compiló el APK ni se probó en un Android real**: el entorno donde se construyó no tenía Android SDK (Google bloqueado por red). El servicio, la cola y el plugin están escritos pero sin compilar.
- ❌ **No se verificó qué campos entrega Google Wallet de verdad** ni si llegan con la app cerrada. Los formatos del parser son suposiciones razonables.

## Cómo compilar

Requisitos: Android Studio (trae SDK y JDK 17).

```bash
npm install
npm run android:sync     # build web + copia a android/
npm run android:open     # abre Android Studio → Run ▶ en tu celular (USB con depuración activada)
```

## Prueba en el celular (hazla en este orden)

### 0. Ver qué manda Google Wallet de verdad (lo más importante)
1. Conecta el celular por USB y en una terminal: `adb shell dumpsys notification --noredact | grep -A 30 walletnfcrel`
2. Paga algo pequeño con Wallet (un tinto). Vuelve a correr el comando.
3. Mira `android.title`, `android.text` y `android.bigText`. Si el formato no coincide con los casos de `NotificationParserTest.kt`, agrega ese texto como prueba nueva y ajusta las regex hasta que pase.
4. Repite con la app de tu banco si la vas a habilitar, y confirma su **nombre de paquete** (`adb shell pm list packages | grep -i bancolombia`). Los de `KNOWN_SOURCES` en `src/domain/capture.ts` no están verificados.

### 1. Activar
Luka → ⚙️ Ajustes → Registro automático → **Activar** → Android abre «Acceso a notificaciones» → enciende Luka. Elige fuentes (Google Wallet ya viene marcada).

### 2. Compra que se guarda sola
1. Primero vincula la tarjeta: la primera compra con una tarjeta nueva cae en «Por revisar» (falta cuenta). Confírmala marcando «Usar esta cuenta siempre».
2. **Cierra Luka** (quítala de recientes). Paga otra cosa con la misma tarjeta.
3. Abre Luka: debe aparecer el gasto con la etiqueta *Google Wallet*. Tócalo → «Deshacer» debe devolver el saldo.
   - Si no aparece: `adb shell dumpsys notification | grep -i luka` para ver si el listener está conectado. Algunas marcas (Xiaomi, Samsung, Huawei) matan servicios en segundo plano: quita la optimización de batería para Luka.

### 3. Compra con datos incompletos
Una compra en dólares (p. ej. una suscripción) o una notificación sin monto → debe quedar en «Por revisar» y **los saldos no cambian** hasta que la confirmes.

### 4. Aviso duplicado del banco
Habilita también la app del banco. Paga con Wallet: llegan dos avisos (Wallet y banco).
- Si coinciden monto, hora (±10 min) **y** tarjeta o comercio → un solo gasto.
- Si solo coinciden monto y hora → el segundo queda «Por revisar» como *posible duplicado*.

### 5. Compra rechazada
Si te rechazan una compra, el aviso nunca debe sumar a gastos (se descarta).

## Privacidad
- El permiso de Android técnicamente deja ver todas las notificaciones. El servicio descarta en la primera línea las que no son de las fuentes elegidas, sin leerlas.
- No se guarda el texto completo, solo: monto, moneda, comercio, fecha y últimos 4 dígitos.
- Nada sale del celular. `allowBackup` está desactivado para que los datos financieros no se copien a la nube de Google; usa el respaldo JSON de Ajustes.
