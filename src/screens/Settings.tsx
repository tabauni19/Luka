// Ajustes: cuentas, tema, registro automático, exportar/respaldar, modo demo.

import { useEffect, useRef, useState } from 'react';
import { loadDemo } from '../data/demo';
import { KNOWN_SOURCES, processCaptures, sourceLabel, WALLET_PACKAGE, type CapturedEvent } from '../domain/capture';
import { accountBalances } from '../domain/ledger';
import { transactionsToCSV } from '../domain/csv';
import type { Settings } from '../domain/types';
import { AutoCapture, isNative, syncCaptures } from '../native/autoCapture';
import { useApp } from '../state';
import { AccountSelect, confirmAsk, Icon, Money, Segmented, Sheet } from '../ui/kit';

function download(name: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function AutoCaptureSection() {
  const { data, mutate, toast, repo, refresh } = useApp();
  const native = isNative();
  const [granted, setGranted] = useState<boolean | null>(null);
  const cfg = data.settings.autoCapture;

  const check = async () => {
    if (!native) return;
    const s = await AutoCapture.getStatus();
    setGranted(s.permissionGranted);
  };
  useEffect(() => {
    check();
    const onVis = () => document.visibilityState === 'visible' && check();
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveCfg = async (patch: Partial<Settings['autoCapture']>) => {
    const next = { ...cfg, ...patch };
    await mutate((r) => r.saveSettings({ autoCapture: next }));
    if (native) await AutoCapture.setConfig(next);
  };

  const toggleSource = (pkg: string) => saveCfg({ sources: cfg.sources.includes(pkg) ? cfg.sources.filter((s) => s !== pkg) : [...cfg.sources, pkg] });

  // Solo en desarrollo (npm run dev): inyecta notificaciones simuladas para probar el flujo en el navegador.
  const simulate = async (kind: 'ok' | 'incompleta' | 'duplicada' | 'rechazada') => {
    const now = Date.now();
    const base = { app: WALLET_PACKAGE, postedAt: now, declined: false, currency: 'COP', cardLast4: '4321' };
    const evs: CapturedEvent[] =
      kind === 'ok' ? [{ ...base, id: `sim-${now}`, amount: 23_500, merchant: 'Juan Valdez Café' }]
      : kind === 'incompleta' ? [{ ...base, id: `sim-${now}`, merchant: 'Tienda D1', cardLast4: '9999', amount: 15_200 }]
      : kind === 'rechazada' ? [{ ...base, id: `sim-${now}`, amount: 50_000, merchant: 'Falabella', declined: true }]
      : [{ ...base, id: `sim-${now}-w`, amount: 80_000, merchant: 'Éxito Unicentro' }, { ...base, app: 'com.todo1.mobile', id: `sim-${now}-b`, postedAt: now + 30_000, amount: 80_000, merchant: 'EXITO UNICENTRO' }];
    let d = await repo.load();
    const first = d.accounts.find((a) => a.type === 'credit' && !a.archived) ?? d.accounts.find((a) => !a.archived);
    if (first && !d.cardLinks.some((l) => l.last4 === '4321' && l.accountId)) {
      await repo.put('cardLinks', { id: `${WALLET_PACKAGE}:4321`, app: WALLET_PACKAGE, last4: '4321', label: 'Google Wallet •••• 4321 (simulada)', accountId: first.id });
      d = await repo.load();
    }
    const r = processCaptures(evs, { ...d, settings: { ...d.settings, autoCapture: { enabled: true, sources: [WALLET_PACKAGE, 'com.todo1.mobile'] } } });
    await repo.applyCaptureResult(r);
    await refresh();
    toast(`Simulación: ${r.transactions.length} guardada(s), ${r.reviewItems.length} por revisar, ${r.ignored.length} ignorada(s)`);
  };

  return (
    <section className="card">
      <h3 className="card-title"><Icon name="bell" size={18} /> Registro automático</h3>
      <p className="small">
        Luka puede leer las notificaciones de compra de <b>Google Wallet</b> y de las apps bancarias que elijas, y registrar el gasto por ti aunque la app esté cerrada.
      </p>
      <details className="explain">
        <summary>¿Qué acceso pide Android?</summary>
        <ul className="small">
          <li>Android llama a este permiso <b>«Acceso a notificaciones»</b>. Técnicamente deja ver todas las notificaciones, pero Luka descarta al instante las que no son de las fuentes que actives aquí.</li>
          <li>De cada compra solo guarda en el celular: monto, moneda, comercio, fecha y los últimos 4 dígitos de la tarjeta. No guarda el texto completo ni lo envía a ningún servidor.</li>
          <li>Las compras rechazadas nunca se cuentan como gasto.</li>
          <li>Puedes quitar el acceso cuando quieras desde aquí o desde Ajustes de Android.</li>
        </ul>
      </details>

      {!native ? (
        <p className="muted small">Disponible solo en la app Android de Luka. En el navegador no se pueden leer notificaciones.</p>
      ) : (
        <>
          <div className="row between">
            <span>Acceso a notificaciones</span>
            <span className={`badge ${granted ? 'ok' : ''}`}>{granted === null ? '…' : granted ? 'Concedido' : 'No concedido'}</span>
          </div>
          <div className="row gap wrap">
            {!cfg.enabled ? (
              <button className="btn primary" onClick={async () => { await saveCfg({ enabled: true, sources: cfg.sources.length ? cfg.sources : [WALLET_PACKAGE] }); if (!granted) await AutoCapture.openPermissionSettings(); }}>Activar</button>
            ) : (
              <button className="btn ghost danger" onClick={async () => { await saveCfg({ enabled: false }); if (granted && confirmAsk('Registro automático desactivado. ¿Quieres quitar también el acceso a notificaciones en Android?')) await AutoCapture.openPermissionSettings(); }}>Desactivar</button>
            )}
            {cfg.enabled && !granted && <button className="btn ghost" onClick={() => AutoCapture.openPermissionSettings()}>Conceder acceso</button>}
            {cfg.enabled && granted && (
              <button className="btn ghost" onClick={async () => { const r = await syncCaptures(repo); await refresh(); toast(`Sincronizado: ${r.saved} guardada(s), ${r.review} por revisar`); }}>Sincronizar ahora</button>
            )}
          </div>
        </>
      )}

      {(native || import.meta.env.DEV) && (
        <>
          <h4 className="section-title">Fuentes</h4>
          <ul className="plain-list">
            {KNOWN_SOURCES.map((s) => (
              <li key={s.pkg}>
                <label className="check">
                  <input type="checkbox" checked={cfg.sources.includes(s.pkg)} onChange={() => toggleSource(s.pkg)} disabled={native && !cfg.enabled} />
                  {s.label}{s.wallet ? ' (recomendado)' : ''}
                </label>
              </li>
            ))}
          </ul>
        </>
      )}

      {data.cardLinks.length > 0 && (
        <>
          <h4 className="section-title">Tarjetas detectadas</h4>
          <p className="muted small">Vincula cada tarjeta con una cuenta para que sus compras se guarden solas.</p>
          <ul className="plain-list">
            {data.cardLinks.map((l) => (
              <li key={l.id} className="link-row">
                <span>{l.label || `${sourceLabel(l.app)}${l.last4 ? ` •••• ${l.last4}` : ''}`}</span>
                <AccountSelect accounts={data.accounts} value={l.accountId} placeholder="Sin vincular" onChange={(id) => mutate((r) => r.put('cardLinks', { ...l, accountId: id }))} />
              </li>
            ))}
          </ul>
        </>
      )}

      {import.meta.env.DEV && !native && (
        <div className="devbox">
          <p className="small"><b>Modo desarrollo:</b> simula notificaciones para probar el flujo.</p>
          <div className="chips">
            <button className="chip" onClick={() => simulate('ok')}>Compra completa</button>
            <button className="chip" onClick={() => simulate('incompleta')}>Datos incompletos</button>
            <button className="chip" onClick={() => simulate('duplicada')}>Wallet + banco</button>
            <button className="chip" onClick={() => simulate('rechazada')}>Rechazada</button>
          </div>
        </div>
      )}
    </section>
  );
}

export function SettingsSheet({ onClose, onNewAccount, onOpenAccount }: { onClose: () => void; onNewAccount: () => void; onOpenAccount: (id: string) => void }) {
  const { data, mutate, toast, repo, today } = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const bal = accountBalances(data.accounts, data.transactions);
  const hasDemo = data.settings.demoMode || data.accounts.some((a) => a.demo);

  const exportCSV = () => {
    download(`luka-movimientos-${today}.csv`, transactionsToCSV(data), 'text/csv;charset=utf-8');
    toast('CSV descargado');
  };
  const backup = async () => {
    download(`luka-respaldo-${today}.json`, JSON.stringify(await repo.exportAll(), null, 2), 'application/json');
    toast('Respaldo descargado');
  };
  const restore = async (f: File) => {
    try {
      const raw = JSON.parse(await f.text());
      if (!confirmAsk('Importar reemplaza TODOS los datos actuales por los del respaldo. ¿Seguir?')) return;
      await mutate((r) => r.importAll(raw));
      toast('Respaldo importado');
    } catch (e) {
      toast(`No se pudo importar: ${(e as Error).message}`);
    }
  };

  return (
    <Sheet title="Ajustes" onClose={onClose}>
      <section className="card">
        <div className="row between">
          <h3 className="card-title">Cuentas</h3>
          <button className="link" onClick={onNewAccount}>+ Agregar</button>
        </div>
        {data.accounts.length === 0 ? <p className="muted small">Sin cuentas.</p> : (
          <ul className="acc-list">
            {data.accounts.map((a) => (
              <li key={a.id}>
                <button className="acc" onClick={() => onOpenAccount(a.id)}>
                  <span className="acc-dot" style={{ background: a.color }} />
                  <span className="grow">{a.name}{a.archived && <span className="muted small"> · archivada</span>}</span>
                  <Money value={bal.get(a.id) ?? 0} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h3 className="card-title">Apariencia</h3>
        <Segmented label="Tema" value={data.settings.theme} onChange={(t) => mutate((r) => r.saveSettings({ theme: t }))} options={[{ value: 'system', label: 'Sistema' }, { value: 'light', label: 'Claro' }, { value: 'dark', label: 'Oscuro' }]} />
      </section>

      <AutoCaptureSection />

      <section className="card">
        <h3 className="card-title">Tus datos</h3>
        <p className="muted small">Todo se guarda solo en este dispositivo. Haz respaldos de vez en cuando.</p>
        <div className="col gap">
          <button className="btn ghost" onClick={exportCSV} disabled={!data.transactions.length}><Icon name="download" size={18} /> Exportar movimientos (CSV)</button>
          <button className="btn ghost" onClick={backup}><Icon name="download" size={18} /> Descargar respaldo (JSON)</button>
          <button className="btn ghost" onClick={() => fileRef.current?.click()}><Icon name="upload" size={18} /> Importar respaldo</button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) restore(f); e.target.value = ''; }} />
        </div>
      </section>

      <section className="card">
        <h3 className="card-title">Modo demo</h3>
        {hasDemo ? (
          <>
            <p className="small">Estás viendo datos ficticios mezclados con los tuyos (los ficticios están marcados internamente).</p>
            <button className="btn ghost danger" onClick={async () => { await mutate((r) => r.clearDemo()); toast('Datos de ejemplo borrados'); }}>Borrar todos los datos de ejemplo</button>
          </>
        ) : (
          <>
            <p className="small muted">Carga cuentas, movimientos, compromisos y dos metas de ejemplo (un viaje y un celular). Se borran de una vez.</p>
            {data.accounts.length > 0 && <p className="small muted">Para no mezclar cifras ficticias con las tuyas, el modo demo solo se puede cargar cuando no tienes cuentas propias.</p>}
            <button className="btn ghost" disabled={data.accounts.length > 0} onClick={async () => { await mutate((r) => loadDemo(r, today)); toast('Datos de ejemplo cargados'); onClose(); }}>Cargar datos de ejemplo</button>
          </>
        )}
      </section>

      <section className="card">
        <h3 className="card-title">Zona de peligro</h3>
        <button className="btn ghost danger" onClick={async () => { if (confirmAsk('¿Borrar TODOS tus datos de este dispositivo? No se puede deshacer. Descarga un respaldo antes si lo necesitas.')) { await mutate((r) => r.wipe()); toast('Datos borrados'); onClose(); } }}>
          <Icon name="trash" size={16} /> Borrar todo
        </button>
      </section>
      <p className="muted small center">Luka 0.1 · montos en pesos colombianos · hora de Bogotá</p>
    </Sheet>
  );
}
