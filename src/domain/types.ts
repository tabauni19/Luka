// Modelo de datos de Luka.
// Regla de oro: todos los montos son PESOS ENTEROS (number sin decimales).
// Las fechas financieras son strings 'YYYY-MM-DD' en la zona America/Bogota.

export type ISODate = string; // 'YYYY-MM-DD'

export type AccountType = 'cash' | 'bank' | 'wallet' | 'credit';

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  /** Saldo al crear la cuenta. Para tarjetas de crédito es la deuda inicial en positivo. */
  initialBalance: number;
  /** Cupo de la tarjeta (solo informativo). */
  creditLimit?: number;
  color: string;
  archived?: boolean;
  demo?: boolean;
  createdAt: number;
}

export type TxKind = 'expense' | 'income' | 'transfer';

export type TxSource = 'manual' | 'texto' | 'voz' | 'google_wallet' | 'banco' | 'compromiso';

export interface Transaction {
  id: string;
  kind: TxKind;
  amount: number; // siempre positivo
  date: ISODate;
  description: string;
  /** Cuenta de donde sale (gasto, transferencia) o a donde entra (ingreso). */
  accountId: string;
  /** Solo transferencias: cuenta destino. Si es una tarjeta, es un pago a la tarjeta. */
  toAccountId?: string;
  categoryId?: string;
  source: TxSource;
  /** Datos de la captura automática (Android). */
  capture?: { captureId: string; merchant?: string; cardLast4?: string; app: string };
  commitmentId?: string;
  demo?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Category {
  id: string;
  name: string;
  emoji: string;
  color: string;
  kind: 'expense' | 'income';
  /** Tope de gasto por quincena (0 = sin tope). */
  biweeklyLimit: number;
  demo?: boolean;
}

export interface CategoryRule {
  id: string;
  /** Palabras clave normalizadas (sin tildes, minúsculas). */
  key: string;
  categoryId: string;
  createdAt: number;
}

export interface Commitment {
  id: string;
  name: string;
  amount: number;
  /** Día del mes en que se paga (1-31; si el mes es más corto se usa el último día). */
  dayOfMonth: number;
  categoryId?: string;
  /** Cuenta con la que se paga normalmente. */
  accountId?: string;
  /** Si es el pago de una tarjeta: la tarjeta. Al pagarlo se registra una transferencia, no un gasto. */
  cardAccountId?: string;
  active: boolean;
  demo?: boolean;
}

export interface CommitmentPayment {
  id: string; // `${commitmentId}:${dueDate}` → evita pagar dos veces la misma ocurrencia
  commitmentId: string;
  dueDate: ISODate;
  txId: string;
  paidAt: number;
  demo?: boolean;
}

export interface Goal {
  id: string;
  name: string;
  emoji: string;
  target: number;
  deadline: ISODate;
  demo?: boolean;
  createdAt: number;
}

export interface GoalContribution {
  id: string;
  goalId: string;
  /** Positivo = separar, negativo = liberar. */
  amount: number;
  date: ISODate;
  demo?: boolean;
}

export interface Settings {
  /** Días del mes en que te pagan, p. ej. [15, 30]. */
  payDays: number[];
  /** Fecha del próximo pago fijada a mano (gana sobre payDays si es futura). */
  nextPayDateOverride?: ISODate;
  theme: 'system' | 'light' | 'dark';
  demoMode: boolean;
  /** Las fechas de pago las puso el modo demo (se quitan al borrarlo). */
  demoPayDays?: boolean;
  onboarded: boolean;
  /** Registro automático (Android). */
  autoCapture: {
    enabled: boolean;
    sources: string[]; // paquetes Android habilitados
  };
}

/** Vínculo entre una tarjeta detectada en notificaciones y una cuenta de la app. */
export interface CardLink {
  id: string; // `${app}:${last4}` o `${app}:*`
  app: string;
  last4?: string;
  label: string;
  accountId?: string;
}

/** Movimiento capturado que necesita revisión antes de tocar saldos. */
export interface ReviewItem {
  id: string; // = captureId
  captureId: string;
  app: string;
  amount?: number;
  currency?: string;
  merchant?: string;
  cardLast4?: string;
  date: ISODate;
  postedAt: number;
  reason: 'falta_monto' | 'falta_moneda' | 'moneda_extranjera' | 'falta_cuenta' | 'posible_duplicado';
  duplicateOfTxId?: string;
  suggestedCategoryId?: string;
  suggestedAccountId?: string;
  createdAt: number;
}

export interface AppData {
  accounts: Account[];
  transactions: Transaction[];
  categories: Category[];
  rules: CategoryRule[];
  commitments: Commitment[];
  commitmentPayments: CommitmentPayment[];
  goals: Goal[];
  goalContributions: GoalContribution[];
  cardLinks: CardLink[];
  reviewItems: ReviewItem[];
  /** IDs de capturas ya procesadas (para no procesarlas dos veces). */
  processedCaptures: string[];
  settings: Settings;
}

export const DEFAULT_SETTINGS: Settings = {
  payDays: [],
  theme: 'system',
  demoMode: false,
  onboarded: false,
  autoCapture: { enabled: false, sources: [] }
};
