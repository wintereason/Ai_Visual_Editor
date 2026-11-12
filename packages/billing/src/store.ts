export type PaymentRow = { orderId: string; userId: string; packId: string; credits: number; amountPaise: number; currency: "INR"; status: "created" | "paid"; paymentId?: string };
export type ApplyResult = "granted" | "already" | "mismatch" | "unknown";

/** Where payments live. The Supabase version is the real one (migration 5); the memory version is for tests and local development. */
export interface PaymentsStore {
  create(row: Omit<PaymentRow, "status" | "paymentId">): Promise<void>;
  get(orderId: string): Promise<PaymentRow | null>;
  /** Idempotent: grants the credits at most once per order, and only if the amount and currency match what was recorded. */
  apply(orderId: string, paymentId: string, amountPaise: number, currency: string): Promise<ApplyResult>;
}

export class PaymentsError extends Error {
  constructor() { super("Payments are temporarily unavailable. Please try again."); this.name = "PaymentsError"; }
}

/** In-process store. `grant` is called exactly when credits are added. No awaits between the check and the update, so it is race-free. */
export class MemoryPaymentsStore implements PaymentsStore {
  readonly rows = new Map<string, PaymentRow>();
  constructor(private readonly grant: (userId: string, credits: number, reason: string) => void | Promise<void>) {}

  async create(row: Omit<PaymentRow, "status" | "paymentId">) {
    if (this.rows.has(row.orderId)) throw new PaymentsError();
    this.rows.set(row.orderId, { ...row, status: "created" });
  }
  async get(orderId: string) { const r = this.rows.get(orderId); return r ? { ...r } : null; }
  async apply(orderId: string, paymentId: string, amountPaise: number, currency: string): Promise<ApplyResult> {
    const r = this.rows.get(orderId);
    if (!r) return "unknown";
    if (r.status === "paid") return "already";
    if (r.amountPaise !== amountPaise || r.currency !== currency) return "mismatch";
    r.status = "paid"; r.paymentId = paymentId; // before the await below: a second call sees "paid"
    await this.grant(r.userId, r.credits, `purchase ${r.packId}`);
    return "granted";
  }
}

type Client = {
  from: (t: string) => any;
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: any; error: { code?: string; message?: string } | null }>;
};

/** MUST be given a SERVICE-ROLE client created on the server (apply_payment is not callable by users). */
export class SupabasePaymentsStore implements PaymentsStore {
  constructor(private readonly client: Client) {}

  async create(row: Omit<PaymentRow, "status" | "paymentId">) {
    const { error } = await this.client.from("payments").insert({ user_id: row.userId, order_id: row.orderId, pack_id: row.packId, credits: row.credits, amount_paise: row.amountPaise, currency: row.currency });
    if (error) throw new PaymentsError();
  }
  async get(orderId: string): Promise<PaymentRow | null> {
    const { data, error } = await this.client.from("payments").select("user_id, order_id, pack_id, credits, amount_paise, currency, status, payment_id").eq("order_id", orderId).maybeSingle();
    if (error) throw new PaymentsError();
    if (!data) return null;
    return { orderId: data.order_id, userId: data.user_id, packId: data.pack_id, credits: data.credits, amountPaise: data.amount_paise, currency: "INR", status: data.status, ...(data.payment_id ? { paymentId: data.payment_id } : {}) };
  }
  async apply(orderId: string, paymentId: string, amountPaise: number, currency: string): Promise<ApplyResult> {
    const { data, error } = await this.client.rpc("apply_payment", { p_order_id: orderId, p_payment_id: paymentId, p_amount: amountPaise, p_currency: currency });
    if (error) throw new PaymentsError();
    return data === "granted" || data === "already" || data === "mismatch" || data === "unknown" ? data : (() => { throw new PaymentsError(); })();
  }
}
