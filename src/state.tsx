// Estado global: la base de datos (Repo), los datos cargados y utilidades de UI (toasts).
// Patrón: cada cambio → escribir en IndexedDB → `refresh()` vuelve a leer todo.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Repo } from './data/repo';
import { todayBogota } from './domain/dates';
import type { AppData } from './domain/types';

interface Toast {
  id: number;
  text: string;
  action?: { label: string; run: () => void | Promise<void> };
}

interface Ctx {
  repo: Repo;
  data: AppData;
  today: string;
  refresh: () => Promise<void>;
  /** Ejecuta un cambio y recarga. */
  mutate: (fn: (repo: Repo) => Promise<unknown>) => Promise<void>;
  toast: (text: string, action?: Toast['action']) => void;
}

const AppCtx = createContext<Ctx | null>(null);

export function useApp(): Ctx {
  const c = useContext(AppCtx);
  if (!c) throw new Error('useApp fuera del proveedor');
  return c;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [repo, setRepo] = useState<Repo | null>(null);
  const [data, setData] = useState<AppData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [today, setToday] = useState(todayBogota());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  useEffect(() => {
    Repo.open()
      .then(async (r) => {
        setRepo(r);
        setData(await r.load());
      })
      .catch((e) => setError(String(e?.message ?? e)));
  }, []);

  // Si la app queda abierta pasada la medianoche (Bogotá), cambia el "hoy".
  useEffect(() => {
    const t = setInterval(() => setToday(todayBogota()), 60_000);
    return () => clearInterval(t);
  }, []);

  const refresh = useCallback(async () => {
    if (repo) setData(await repo.load());
  }, [repo]);

  const toast = useCallback((text: string, action?: Toast['action']) => {
    const id = ++toastId.current;
    setToasts([{ id, text, action }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), action ? 7000 : 3500);
  }, []);

  const mutate = useCallback(
    async (fn: (repo: Repo) => Promise<unknown>) => {
      if (!repo) return;
      try {
        await fn(repo);
      } catch (e) {
        toast(`No se pudo guardar: ${(e as Error).message}`);
      }
      setData(await repo.load());
    },
    [repo, toast]
  );

  const value = useMemo(() => (repo && data ? { repo, data, today, refresh, mutate, toast } : null), [repo, data, today, refresh, mutate, toast]);

  if (error)
    return (
      <div className="boot">
        <p>No pudimos abrir el almacenamiento local del navegador.</p>
        <p className="muted">{error}</p>
        <p className="muted">Si estás en modo incógnito, abre Luka en una ventana normal.</p>
      </div>
    );
  if (!value) return <div className="boot"><div className="logo-dot" /></div>;

  return (
    <AppCtx.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="toast">
            <span>{t.text}</span>
            {t.action && (
              <button
                className="toast-action"
                onClick={async () => {
                  setToasts((x) => x.filter((y) => y.id !== t.id));
                  await t.action!.run();
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </AppCtx.Provider>
  );
}
