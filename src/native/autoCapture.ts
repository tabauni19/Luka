// Puente con el módulo nativo Android (Kotlin) del registro automático.
// En la web/PWA no existe: `isNative()` devuelve false y la sección se muestra como
// "solo disponible en la app Android".

import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { CapturedEvent } from '../domain/capture';
import { processCaptures } from '../domain/capture';
import type { Repo } from '../data/repo';

export interface AutoCapturePlugin {
  /** ¿El usuario ya activó "Acceso a notificaciones" para Luka? */
  getStatus(): Promise<{ permissionGranted: boolean; queued: number }>;
  /** Abre la pantalla de Android donde se concede (o quita) el acceso. */
  openPermissionSettings(): Promise<void>;
  /** Qué fuentes procesar. El servicio ignora todo lo demás sin guardarlo. */
  setConfig(o: { enabled: boolean; sources: string[] }): Promise<void>;
  /** Lee la cola persistente (no la borra). */
  readQueue(): Promise<{ events: CapturedEvent[] }>;
  /** Borra de la cola los eventos ya aplicados. */
  ack(o: { ids: string[] }): Promise<void>;
  addListener(event: 'captured', fn: () => void): Promise<PluginListenerHandle>;
}

export const AutoCapture = registerPlugin<AutoCapturePlugin>('AutoCapture');

export const isNative = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

/**
 * Sincroniza la cola nativa con los movimientos:
 * leer → decidir (processCaptures) → guardar todo en una transacción → recién ahí borrar de la cola.
 * Si la app se cierra a mitad, los eventos siguen en la cola y no se duplican porque
 * cada id queda marcado como procesado.
 */
export async function syncCaptures(repo: Repo): Promise<{ saved: number; review: number }> {
  if (!isNative()) return { saved: 0, review: 0 };
  const { events } = await AutoCapture.readQueue();
  if (!events.length) return { saved: 0, review: 0 };
  const data = await repo.load();
  const r = processCaptures(events, data);
  await repo.applyCaptureResult(r);
  await AutoCapture.ack({ ids: events.map((e) => e.id) });
  return { saved: r.transactions.length, review: r.reviewItems.length };
}
