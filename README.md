# Luka · finanzas personales

App web instalable (PWA) para registrar gastos en una frase y saber en segundos:
**¿cuánto tengo?, ¿cuánto me queda libre hasta el próximo pago?, ¿cómo van mis metas?**
Español de Colombia, pesos (COP) enteros, fechas en `America/Bogota`. Todo funciona en local, sin registro ni claves.

## Comandos

```bash
npm install
npm run dev        # http://localhost:5173 (en el celular: http://IP-de-tu-PC:5173 con npm run dev -- --host)
npm test           # 34 pruebas (parser, contabilidad, presupuesto, captura Android simulada)
npm run typecheck  # chequeo de tipos
npm run build      # build de producción en dist/
npm run preview    # sirve dist/ (aquí se puede instalar como app)

# Android (necesita Android Studio)
npm run android:sync && npm run android:open
cd android-parser-tests && gradle test   # pruebas del parser Kotlin en la JVM
```

## Arquitectura

```
src/
  domain/      ← lógica pura, sin React ni base de datos (fácil de probar)
    types.ts     modelo de datos
    parser.ts    frase → borradores ("18 lucas", "12k", "1,5 millones", "ayer", cuentas, tipo)
    categories.ts palabras clave + reglas aprendidas cuando corriges una categoría
    ledger.ts    saldos y totales DERIVADOS de los movimientos
    budget.ts    quincenas, compromisos, disponible, $/día, metas
    capture.ts   reglas del registro automático (Android)
    csv.ts, dates.ts, money.ts
  data/repo.ts   IndexedDB (librería idb): guardar, borrar, respaldo, demo
  state.tsx      contexto React: cada cambio escribe en IndexedDB y vuelve a leer
  screens/       Inicio, Movimientos, Registrar, Presupuesto, Metas, Ajustes, Por revisar
  native/        puente con el plugin Kotlin
android/         proyecto Capacitor + módulo Kotlin (ver docs/ANDROID.md)
tests/           Vitest + fake-indexeddb
```

### Reglas de dinero
- **No se guardan saldos**: se calculan de saldo inicial + movimientos. Editar o borrar un movimiento corrige la cuenta sola.
- Gasto con tarjeta → sube la deuda y cuenta como gasto. Pago a la tarjeta = **transferencia** hacia la tarjeta → baja la deuda y el banco, **no** es gasto. Transferencias nunca suman a gastos.
- **Disponible** = saldo líquido − separado para metas − compromisos pendientes antes del próximo pago. Marcar un compromiso como pagado crea el movimiento y lo saca de pendientes: se descuenta una sola vez (ids derivados `compromiso:fecha` evitan dobles pagos).
- Guardar un borrador usa su id como id del movimiento: guardarlo dos veces no duplica.

## Limitaciones conocidas
- Dictado: usa la Web Speech API (Chrome en Android y escritorio sí; Firefox no; dentro de la app Android de Capacitor normalmente no). Texto y formulario siempre funcionan; el micrófono del teclado sirve igual.
- No hay IA externa: el analizador es local. Frases muy libres pueden requerir corregir el borrador.
- Los datos viven en el navegador/dispositivo. Si borras datos del navegador se pierden: usa el respaldo JSON.
- Android: ver la sección «Qué se probó y qué NO» en `docs/ANDROID.md`.
- WhatsApp y conexión bancaria: pendientes para la v2.
