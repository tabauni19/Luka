// Componentes reutilizables de la interfaz.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { formatCOP } from '../domain/money';
import type { Account, Category } from '../domain/types';

// ---------- Íconos (SVG en línea, sin dependencias) ----------
const paths: Record<string, string> = {
  home: 'M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  list: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
  plus: 'M12 5v14M5 12h14',
  pie: 'M12 3v9l7.8 4.5A9 9 0 1 1 12 3zM15 3.5A9 9 0 0 1 20.5 9H15z',
  flag: 'M5 21V4m0 0h11l-2 4 2 4H5',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.5 7.5 0 0 0-2-1.2L14.5 3h-4l-.4 2.6a7.5 7.5 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.5 7.5 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7.5 7.5 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z',
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3',
  text: 'M4 6h16M4 12h10M4 18h7',
  form: 'M5 4h14v16H5zM9 9h6M9 13h6M9 17h3',
  close: 'M6 6l12 12M18 6 6 18',
  back: 'M15 5l-7 7 7 7',
  chev: 'M9 6l6 6-6 6',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  check: 'M5 12.5 10 17l9-10',
  alert: 'M12 8v5M12 16.5h.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  wallet: 'M3 7a2 2 0 0 1 2-2h13v4M3 7v11a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2zM16 14.5h.01',
  swap: 'M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7',
  calendar: 'M4 6h16v15H4zM4 10h16M8 3v4M16 3v4',
  download: 'M12 4v11m0 0 4.5-4.5M12 15l-4.5-4.5M5 20h14',
  upload: 'M12 20V9m0 0 4.5 4.5M12 9l-4.5 4.5M5 4h14',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z',
  bell: 'M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0',
  undo: 'M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  eyeOff: 'M3 3l18 18M10.6 5.1A10.6 10.6 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.8 8.3 2 12 2 12s3.5 7 10 7c1.6 0 3-.4 4.3-1M9.9 9.9a3 3 0 0 0 4.2 4.2'
};

export function Icon({ name, size = 22, stroke = 2 }: { name: keyof typeof paths | string; size?: number; stroke?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[name] ?? ''} />
    </svg>
  );
}

// ---------- Sheet (modal inferior) ----------
export function Sheet({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.classList.add('no-scroll');
    ref.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('no-scroll');
    };
  }, [onClose]);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar">
            <Icon name="close" />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>
  );
}

// ---------- Montos ----------
export function Money({ value, className = '', signed = false }: { value: number; className?: string; signed?: boolean }) {
  const txt = signed && value > 0 ? `+${formatCOP(value)}` : formatCOP(value);
  return <span className={`money ${className}`}>{txt}</span>;
}

/** Input de pesos con separador de miles mientras escribes. */
export function AmountInput({ value, onChange, autoFocus, id, placeholder = '$0', invalid }: { value: number | null; onChange: (v: number | null) => void; autoFocus?: boolean; id?: string; placeholder?: string; invalid?: boolean }) {
  const [txt, setTxt] = useState(value ? new Intl.NumberFormat('es-CO').format(value) : '');
  useEffect(() => {
    const cur = parseInt(txt.replace(/\D/g, '') || '0', 10);
    if ((value ?? 0) !== cur) setTxt(value ? new Intl.NumberFormat('es-CO').format(value) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div className={`amount-input ${invalid ? 'invalid' : ''}`}>
      <span>$</span>
      <input
        id={id}
        inputMode="numeric"
        autoFocus={autoFocus}
        placeholder={placeholder.replace('$', '')}
        value={txt}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, '').slice(0, 12);
          const n = digits ? parseInt(digits, 10) : null;
          setTxt(n ? new Intl.NumberFormat('es-CO').format(n) : '');
          onChange(n);
        }}
      />
    </div>
  );
}

export function Field({ label, children, hint, htmlFor }: { label: string; children: ReactNode; hint?: ReactNode; htmlFor?: string }) {
  return (
    <label className="field" htmlFor={htmlFor}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function AccountSelect({ accounts, value, onChange, placeholder = 'Elige una cuenta', exclude, invalid, filter }: { accounts: Account[]; value: string | null | undefined; onChange: (id: string) => void; placeholder?: string; exclude?: string | null; invalid?: boolean; filter?: (a: Account) => boolean }) {
  return (
    <select className={invalid ? 'invalid' : ''} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
      <option value="" disabled>
        {placeholder}
      </option>
      {accounts
        .filter((a) => !a.archived && a.id !== exclude && (!filter || filter(a)))
        .map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
            {a.type === 'credit' ? ' (tarjeta)' : ''}
          </option>
        ))}
    </select>
  );
}

export function CategorySelect({ categories, value, onChange, kind }: { categories: Category[]; value?: string; onChange: (id: string) => void; kind: 'expense' | 'income' }) {
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
      {categories
        .filter((c) => c.kind === kind && (!c.hidden || c.id === value))
        .map((c) => (
          <option key={c.id} value={c.id}>
            {c.emoji} {c.name}
          </option>
        ))}
    </select>
  );
}

export function Progress({ value, tone = 'brand' }: { value: number; tone?: 'brand' | 'warn' | 'danger' }) {
  return (
    <div className={`progress ${tone}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)}>
      <div style={{ width: `${Math.min(100, Math.max(0, value * 100))}%` }} />
    </div>
  );
}

export function Empty({ icon, title, text, action }: { icon: string; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon name={icon} size={28} />
      </div>
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {action}
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={value === o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function confirmAsk(msg: string): boolean {
  return typeof window !== 'undefined' ? window.confirm(msg) : true;
}
