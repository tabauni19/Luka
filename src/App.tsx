// Estructura de la app: pantallas + navegación inferior + hojas (modales).

import { useEffect, useState } from 'react';
import { loadDemo } from './data/demo';
import { AutoCapture, isNative, syncCaptures } from './native/autoCapture';
import { AccountDetail, AccountForm } from './screens/Accounts';
import { BudgetScreen } from './screens/Budget';
import { GoalsScreen } from './screens/Goals';
import { HomeScreen } from './screens/Home';
import { MovementsScreen, TxEditSheet } from './screens/Movements';
import { RegisterSheet, type RegisterMode } from './screens/Register';
import { ReviewSheet } from './screens/Review';
import { SettingsSheet } from './screens/Settings';
import { useApp } from './state';
import { Icon } from './ui/kit';

type Tab = 'inicio' | 'movimientos' | 'presupuesto' | 'metas';
type Overlay =
  | { type: 'register'; mode: RegisterMode }
  | { type: 'registerPicker' }
  | { type: 'account'; id: string }
  | { type: 'newAccount' }
  | { type: 'tx'; id: string }
  | { type: 'settings' }
  | { type: 'review' }
  | null;

export function App() {
  const { data, mutate, today, repo, refresh, toast } = useApp();
  const [tab, setTab] = useState<Tab>('inicio');
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [stack, setStack] = useState<Overlay[]>([]);
  const [catFilter, setCatFilter] = useState<{ id: string; n: number } | null>(null);

  // Tema claro/oscuro
  useEffect(() => {
    const root = document.documentElement;
    if (data.settings.theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', data.settings.theme);
  }, [data.settings.theme]);

  // Android: sincronizar la cola de compras detectadas al abrir y al volver a la app.
  useEffect(() => {
    if (!isNative()) return;
    const run = async () => {
      try {
        const r = await syncCaptures(repo);
        if (r.saved || r.review) {
          await refresh();
          toast(`${r.saved ? `${r.saved} compra(s) registradas desde notificaciones` : ''}${r.saved && r.review ? ' · ' : ''}${r.review ? `${r.review} por revisar` : ''}`);
        }
      } catch {
        /* sin cola o plugin no disponible */
      }
    };
    run();
    AutoCapture.setConfig(data.settings.autoCapture).catch(() => undefined);
    const onVis = () => document.visibilityState === 'visible' && run();
    document.addEventListener('visibilitychange', onVis);
    const h = AutoCapture.addListener('captured', run);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      h.then((x) => x.remove()).catch(() => undefined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo]);

  const open = (o: Overlay) => {
    if (overlay) setStack((s) => [...s, overlay]);
    setOverlay(o);
  };
  const close = () => {
    setOverlay(stack[stack.length - 1] ?? null);
    setStack((s) => s.slice(0, -1));
  };
  const replace = (o: Overlay) => setOverlay(o);
  const closeAll = () => {
    setOverlay(null);
    setStack([]);
  };

  const go = (t: Tab) => {
    closeAll();
    setTab(t);
    window.scrollTo({ top: 0 });
  };

  return (
    <div className="app">
      <main>
        {tab === 'inicio' && (
          <HomeScreen
            onOpenAccount={(id) => open({ type: 'account', id })}
            onNewAccount={() => open({ type: 'newAccount' })}
            onEditTx={(id) => open({ type: 'tx', id })}
            onGoBudget={() => go('presupuesto')}
            onGoGoals={() => go('metas')}
            onOpenReview={() => open({ type: 'review' })}
            onOpenSettings={() => open({ type: 'settings' })}
            onLoadDemo={() => mutate((r) => loadDemo(r, today))}
          />
        )}
        {tab === 'movimientos' && (
          <MovementsScreen
            key={catFilter?.n ?? 0}
            initialCategory={catFilter?.id ?? null}
            onEditTx={(id) => open({ type: 'tx', id })}
            onOpenRegister={() => open({ type: 'register', mode: 'texto' })}
            onOpenReview={() => open({ type: 'review' })}
          />
        )}
        {tab === 'presupuesto' && <BudgetScreen onPickCategory={(id) => { setCatFilter({ id, n: Date.now() }); go('movimientos'); }} />}
        {tab === 'metas' && <GoalsScreen />}
      </main>

      <nav className="tabbar" aria-label="Navegación principal">
        <TabBtn icon="home" label="Inicio" on={tab === 'inicio'} onClick={() => go('inicio')} />
        <TabBtn icon="list" label="Movimientos" on={tab === 'movimientos'} onClick={() => { setCatFilter(null); go('movimientos'); }} />
        <button className="tab-register" onClick={() => open({ type: 'registerPicker' })} aria-label="Registrar">
          <span className="fab"><Icon name="plus" size={28} stroke={2.6} /></span>
          <span>Registrar</span>
        </button>
        <TabBtn icon="pie" label="Presupuesto" on={tab === 'presupuesto'} onClick={() => go('presupuesto')} />
        <TabBtn icon="flag" label="Metas" on={tab === 'metas'} onClick={() => go('metas')} />
      </nav>

      {overlay?.type === 'registerPicker' && (
        <div className="sheet-backdrop" onClick={close}>
          <div className="picker" role="dialog" aria-label="¿Cómo quieres registrar?" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => replace({ type: 'register', mode: 'texto' })}><Icon name="text" /> <span><b>Escribir</b><small>Varios gastos en una frase</small></span></button>
            <button onClick={() => replace({ type: 'register', mode: 'voz' })}><Icon name="mic" /> <span><b>Dictar</b><small>Dilo en voz alta</small></span></button>
            <button onClick={() => replace({ type: 'register', mode: 'form' })}><Icon name="form" /> <span><b>Formulario</b><small>Campo por campo</small></span></button>
          </div>
        </div>
      )}
      {overlay?.type === 'register' && <RegisterSheet initialMode={overlay.mode} onClose={close} onNeedAccount={() => replace({ type: 'newAccount' })} />}
      {overlay?.type === 'account' && <AccountDetail accountId={overlay.id} onClose={close} onEditTx={(id) => open({ type: 'tx', id })} />}
      {overlay?.type === 'newAccount' && <AccountForm onClose={close} />}
      {overlay?.type === 'tx' && <TxEditSheet key={overlay.id} txId={overlay.id} onClose={close} />}
      {overlay?.type === 'review' && <ReviewSheet onClose={close} />}
      {overlay?.type === 'settings' && <SettingsSheet onClose={close} onNewAccount={() => open({ type: 'newAccount' })} onOpenAccount={(id) => open({ type: 'account', id })} />}
    </div>
  );
}

function TabBtn({ icon, label, on, onClick }: { icon: string; label: string; on: boolean; onClick: () => void }) {
  return (
    <button className={`tab ${on ? 'on' : ''}`} onClick={onClick} aria-current={on ? 'page' : undefined}>
      <Icon name={icon} size={22} />
      <span>{label}</span>
    </button>
  );
}
