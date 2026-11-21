import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import path from 'node:path';
import type {
  AuditChainVerification,
  AuditEventType,
  AuditLogEntry,
  DirectoryUser,
  GatewayProviderType,
  GatewayStatus,
  PaymentGateway,
  TransactionRecord,
  UserProfile,
  UserRole,
} from '../src/shared/types.ts';

const DB_PATH = path.resolve(process.cwd(), 'royal_patti.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'player',
    balance_paise INTEGER NOT NULL DEFAULT 0,
    escrowed_paise INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS payment_gateways (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    code TEXT UNIQUE NOT NULL,
    provider_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    fee_percent REAL NOT NULL DEFAULT 0,
    fixed_fee_paise INTEGER NOT NULL DEFAULT 0,
    min_amount_paise INTEGER NOT NULL DEFAULT 10000,
    max_amount_paise INTEGER NOT NULL DEFAULT 10000000,
    daily_limit_paise INTEGER NOT NULL DEFAULT 50000000,
    settlement_sla TEXT NOT NULL DEFAULT 'Instant',
    priority INTEGER NOT NULL DEFAULT 1,
    webhook_secret_hint TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    reference_code TEXT UNIQUE NOT NULL,
    idempotency_key TEXT UNIQUE,
    type TEXT NOT NULL,
    user_id TEXT NOT NULL,
    counterparty_id TEXT,
    gateway_id TEXT,
    table_id TEXT,
    gross_amount_paise INTEGER NOT NULL,
    fee_paise INTEGER NOT NULL DEFAULT 0,
    net_amount_paise INTEGER NOT NULL,
    status TEXT NOT NULL,
    payment_handle TEXT,
    note TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    sequence_no INTEGER UNIQUE NOT NULL,
    event_type TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    actor_name TEXT NOT NULL,
    counterparty_id TEXT,
    counterparty_name TEXT,
    gateway_id TEXT,
    table_id TEXT,
    reference_code TEXT NOT NULL,
    amount_paise INTEGER NOT NULL,
    fee_paise INTEGER NOT NULL DEFAULT 0,
    balance_before_paise INTEGER NOT NULL,
    balance_after_paise INTEGER NOT NULL,
    status TEXT NOT NULL,
    metadata_json TEXT NOT NULL,
    prev_hash TEXT NOT NULL,
    entry_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, key] = stored.split(':');
  if (!salt || !key) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(key, 'hex');
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}

function generateId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function generateRef(prefix: string): string {
  const rand = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `${prefix}-${rand}`;
}

function computeAuditHash(payload: {
  sequenceNo: number;
  prevHash: string;
  eventType: string;
  actorId: string;
  amountPaise: number;
  feePaise: number;
  balanceBeforePaise: number;
  balanceAfterPaise: number;
  referenceCode: string;
  status: string;
  metadataJson: string;
  createdAt: string;
}): string {
  const canonical = [
    payload.sequenceNo,
    payload.prevHash,
    payload.eventType,
    payload.actorId,
    payload.amountPaise,
    payload.feePaise,
    payload.balanceBeforePaise,
    payload.balanceAfterPaise,
    payload.referenceCode,
    payload.status,
    payload.metadataJson,
    payload.createdAt,
  ].join('|');
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

interface AppendAuditInput {
  eventType: AuditEventType;
  actorId: string;
  actorName: string;
  counterpartyId?: string | null;
  counterpartyName?: string | null;
  gatewayId?: string | null;
  tableId?: string | null;
  referenceCode: string;
  amountPaise: number;
  feePaise?: number;
  balanceBeforePaise: number;
  balanceAfterPaise: number;
  status: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;
}

export function appendAuditLog(input: AppendAuditInput): AuditLogEntry {
  const latest = db
    .prepare('SELECT sequence_no, entry_hash FROM audit_logs ORDER BY sequence_no DESC LIMIT 1')
    .get() as { sequence_no: number; entry_hash: string } | undefined;

  const sequenceNo = latest ? latest.sequence_no + 1 : 1;
  const prevHash = latest ? latest.entry_hash : '0'.repeat(64);
  const createdAt = input.createdAt ?? new Date().toISOString();
  const feePaise = input.feePaise ?? 0;
  const metadataJson = JSON.stringify(input.metadata ?? {});
  const entryHash = computeAuditHash({
    sequenceNo,
    prevHash,
    eventType: input.eventType,
    actorId: input.actorId,
    amountPaise: input.amountPaise,
    feePaise,
    balanceBeforePaise: input.balanceBeforePaise,
    balanceAfterPaise: input.balanceAfterPaise,
    referenceCode: input.referenceCode,
    status: input.status,
    metadataJson,
    createdAt,
  });

  const id = generateId('aud');
  db.prepare(
    `INSERT INTO audit_logs (
      id, sequence_no, event_type, actor_id, actor_name,
      counterparty_id, counterparty_name, gateway_id, table_id,
      reference_code, amount_paise, fee_paise,
      balance_before_paise, balance_after_paise, status,
      metadata_json, prev_hash, entry_hash, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    sequenceNo,
    input.eventType,
    input.actorId,
    input.actorName,
    input.counterpartyId ?? null,
    input.counterpartyName ?? null,
    input.gatewayId ?? null,
    input.tableId ?? null,
    input.referenceCode,
    input.amountPaise,
    feePaise,
    input.balanceBeforePaise,
    input.balanceAfterPaise,
    input.status,
    metadataJson,
    prevHash,
    entryHash,
    createdAt
  );

  return {
    id,
    sequenceNo,
    eventType: input.eventType,
    actorId: input.actorId,
    actorName: input.actorName,
    counterpartyId: input.counterpartyId ?? null,
    counterpartyName: input.counterpartyName ?? null,
    gatewayId: input.gatewayId ?? null,
    gatewayName: null,
    tableId: input.tableId ?? null,
    referenceCode: input.referenceCode,
    amountPaise: input.amountPaise,
    feePaise,
    balanceBeforePaise: input.balanceBeforePaise,
    balanceAfterPaise: input.balanceAfterPaise,
    status: input.status,
    metadata: input.metadata ?? {},
    prevHash,
    entryHash,
    createdAt,
  };
}

// Seed initial accounts, gateways, and genesis audit chain if DB is fresh
function seedInitialData(): void {
  const userCount = (db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c;
  const now = new Date().toISOString();

  if (userCount === 0) {
    const defaultPass = hashPassword('patti123');
    const insertUser = db.prepare(
      `INSERT INTO users (id, username, display_name, email, password_hash, role, balance_paise, escrowed_paise, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`
    );

    const seedUsers: Array<[string, string, string, string, UserRole, number]> = [
      ['usr_arjun', 'arjun', 'Arjun Mehta', 'arjun@royalpatti.club', 'admin', 2500000],
      ['usr_priya', 'priya', 'Priya Kapoor', 'priya@royalpatti.club', 'player', 1850000],
      ['usr_kabir', 'kabir', 'Kabir Verma', 'kabir@royalpatti.club', 'player', 1420000],
      ['usr_meera', 'meera', 'Meera Nair', 'meera@royalpatti.club', 'player', 2200000],
    ];

    for (const [id, username, displayName, email, role, balancePaise] of seedUsers) {
      insertUser.run(id, username, displayName, email, defaultPass, role, balancePaise, now);
    }
  }

  const gwCount = (db.prepare('SELECT COUNT(*) as c FROM payment_gateways').get() as { c: number }).c;
  if (gwCount === 0) {
    const insertGw = db.prepare(
      `INSERT INTO payment_gateways (
        id, name, code, provider_type, status, fee_percent, fixed_fee_paise,
        min_amount_paise, max_amount_paise, daily_limit_paise, settlement_sla,
        priority, webhook_secret_hint, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const gateways: Array<
      [string, string, string, GatewayProviderType, GatewayStatus, number, number, number, number, number, string, number, string]
    > = [
      ['gw_rzp_upi', 'Razorpay UPI Instant', 'RZP_UPI', 'UPI', 'ACTIVE', 0, 0, 10000, 10000000, 100000000, 'Instant (< 3s)', 1, 'whsec_rzp_••••94a2'],
      ['gw_stripe_card', 'Stripe Global Cards', 'STRIPE_CARD', 'CARD', 'ACTIVE', 1.8, 200, 25000, 25000000, 250000000, 'Instant', 2, 'whsec_str_••••71f8'],
      ['gw_imps_bank', 'IMPS / NEFT Priority Rail', 'IMPS_BANK', 'BANK_TRANSFER', 'ACTIVE', 0.25, 0, 50000, 50000000, 500000000, '< 2 mins', 3, 'whsec_imp_••••22c9'],
      ['gw_paytm_wallet', 'Paytm Merchant Wallet', 'PAYTM_WLT', 'WALLET', 'ACTIVE', 1.0, 0, 10000, 5000000, 50000000, 'Instant', 4, 'whsec_ptm_••••63d1'],
      ['gw_usdc_poly', 'Polygon USDC Rail', 'POLY_USDC', 'CRYPTO', 'MAINTENANCE', 0.5, 0, 100000, 50000000, 500000000, '~15 secs', 5, 'whsec_ply_••••88b4'],
    ];

    for (const g of gateways) {
      insertGw.run(...g, now, now);
    }
  }

  // Ensure any stale escrows from prior crashes are cleanly released back to wallet
  db.prepare('UPDATE users SET balance_paise = balance_paise + escrowed_paise, escrowed_paise = 0 WHERE escrowed_paise > 0').run();

  const auditCount = (db.prepare('SELECT COUNT(*) as c FROM audit_logs').get() as { c: number }).c;
  if (auditCount === 0) {
    const seedTx = db.transaction(() => {
      const ref1 = 'DEP-GENESIS01';
      db.prepare(
        `INSERT INTO transactions (id, reference_code, idempotency_key, type, user_id, gateway_id, gross_amount_paise, fee_paise, net_amount_paise, status, payment_handle, note, created_at)
         VALUES (?, ?, ?, 'DEPOSIT', 'usr_arjun', 'gw_rzp_upi', 2500000, 0, 2500000, 'COMPLETED', 'arjun@okicici', 'Opening parlor deposit', ?)`
      ).run('tx_seed_1', ref1, 'seed_idem_1', now);

      appendAuditLog({
        eventType: 'DEPOSIT',
        actorId: 'usr_arjun',
        actorName: 'Arjun Mehta',
        gatewayId: 'gw_rzp_upi',
        referenceCode: ref1,
        amountPaise: 2500000,
        feePaise: 0,
        balanceBeforePaise: 0,
        balanceAfterPaise: 2500000,
        status: 'COMPLETED',
        metadata: { gateway: 'Razorpay UPI Instant', paymentHandle: 'arjun@okicici', verification: 'HMAC-SHA256 verified' },
        createdAt: now,
      });

      const ref2 = 'DEP-GENESIS02';
      db.prepare(
        `INSERT INTO transactions (id, reference_code, idempotency_key, type, user_id, gateway_id, gross_amount_paise, fee_paise, net_amount_paise, status, payment_handle, note, created_at)
         VALUES (?, ?, ?, 'DEPOSIT', 'usr_priya', 'gw_stripe_card', 1884000, 34000, 1850000, 'COMPLETED', 'Visa •••• 4242', 'Opening parlor deposit', ?)`
      ).run('tx_seed_2', ref2, 'seed_idem_2', now);

      appendAuditLog({
        eventType: 'DEPOSIT',
        actorId: 'usr_priya',
        actorName: 'Priya Kapoor',
        gatewayId: 'gw_stripe_card',
        referenceCode: ref2,
        amountPaise: 1850000,
        feePaise: 34000,
        balanceBeforePaise: 0,
        balanceAfterPaise: 1850000,
        status: 'COMPLETED',
        metadata: { gateway: 'Stripe Global Cards', paymentHandle: 'Visa •••• 4242', verification: '3DS2 verified' },
        createdAt: now,
      });
    });
    seedTx();
  }
}

seedInitialData();

// Row mappers
function mapUser(row: Record<string, unknown>): UserProfile {
  return {
    id: String(row.id),
    username: String(row.username),
    displayName: String(row.display_name),
    email: String(row.email),
    role: row.role as UserRole,
    balancePaise: Number(row.balance_paise),
    escrowedPaise: Number(row.escrowed_paise),
    createdAt: String(row.created_at),
  };
}

export function getUserById(userId: string): UserProfile | null {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as Record<string, unknown> | undefined;
  return row ? mapUser(row) : null;
}

export function listDirectoryUsers(): DirectoryUser[] {
  const rows = db
    .prepare('SELECT id, username, display_name, role FROM users ORDER BY display_name ASC')
    .all() as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    username: String(r.username),
    displayName: String(r.display_name),
    role: r.role as UserRole,
  }));
}

export function createSessionForUser(userId: string): string {
  const token = crypto.randomBytes(24).toString('hex');
  const now = new Date();
  const expires = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 7);
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    token,
    userId,
    now.toISOString(),
    expires.toISOString()
  );
  return token;
}

export function getUserByToken(token: string | undefined): UserProfile | null {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.* FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > ?`
    )
    .get(token, new Date().toISOString()) as Record<string, unknown> | undefined;
  return row ? mapUser(row) : null;
}

export function deleteSession(token: string): void {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function loginUser(username: string, password: string): { user: UserProfile; token: string } {
  const clean = username.trim().toLowerCase();
  const row = db
    .prepare('SELECT * FROM users WHERE lower(username) = ? OR lower(email) = ?')
    .get(clean, clean) as Record<string, unknown> | undefined;

  if (!row || !verifyPassword(password, String(row.password_hash))) {
    throw new Error('Invalid username or password.');
  }
  const user = mapUser(row);
  const token = createSessionForUser(user.id);
  appendAuditLog({
    eventType: 'AUTH_LOGIN',
    actorId: user.id,
    actorName: user.displayName,
    referenceCode: generateRef('AUTH'),
    amountPaise: 0,
    balanceBeforePaise: user.balancePaise,
    balanceAfterPaise: user.balancePaise,
    status: 'COMPLETED',
    metadata: { method: 'password', username: user.username },
  });
  return { user, token };
}

export function quickSwitchDemoUser(username: string): { user: UserProfile; token: string } {
  const clean = username.trim().toLowerCase();
  const row = db
    .prepare('SELECT * FROM users WHERE lower(username) = ?')
    .get(clean) as Record<string, unknown> | undefined;
  if (!row) {
    throw new Error('Account not found.');
  }
  const user = mapUser(row);
  const token = createSessionForUser(user.id);
  return { user, token };
}

export function registerUser(input: {
  username: string;
  displayName: string;
  email: string;
  password: string;
}): { user: UserProfile; token: string } {
  const username = input.username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
  const displayName = input.displayName.trim();
  const email = input.email.trim().toLowerCase();
  if (username.length < 3 || username.length > 24) {
    throw new Error('Username must be 3–24 letters, numbers, or underscores.');
  }
  if (displayName.length < 2 || displayName.length > 40) {
    throw new Error('Display name must be 2–40 characters.');
  }
  if (!email.includes('@')) {
    throw new Error('Enter a valid email address.');
  }
  if (input.password.length < 6) {
    throw new Error('Password must be at least 6 characters.');
  }

  const existing = db
    .prepare('SELECT id FROM users WHERE lower(username) = ? OR lower(email) = ?')
    .get(username, email);
  if (existing) {
    throw new Error('That username or email is already registered.');
  }

  const id = generateId('usr');
  const now = new Date().toISOString();
  const welcomeBonusPaise = 500000; // ₹5,000 starter bankroll

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO users (id, username, display_name, email, password_hash, role, balance_paise, escrowed_paise, created_at)
       VALUES (?, ?, ?, ?, ?, 'player', ?, 0, ?)`
    ).run(id, username, displayName, email, hashPassword(input.password), welcomeBonusPaise, now);

    const ref = generateRef('WEL');
    appendAuditLog({
      eventType: 'DEPOSIT',
      actorId: id,
      actorName: displayName,
      referenceCode: ref,
      amountPaise: welcomeBonusPaise,
      balanceBeforePaise: 0,
      balanceAfterPaise: welcomeBonusPaise,
      status: 'COMPLETED',
      metadata: { reason: 'New account starter bankroll', username },
      createdAt: now,
    });
  });
  tx();

  const user = getUserById(id)!;
  const token = createSessionForUser(user.id);
  return { user, token };
}

// Payment Gateways
export function listPaymentGateways(): PaymentGateway[] {
  const rows = db
    .prepare(
      `SELECT g.*,
         COALESCE(SUM(CASE WHEN t.status = 'COMPLETED' THEN t.gross_amount_paise ELSE 0 END), 0) AS total_volume_paise,
         COALESCE(SUM(CASE WHEN t.status = 'COMPLETED' THEN t.fee_paise ELSE 0 END), 0) AS total_fees_paise,
         COUNT(CASE WHEN t.status = 'COMPLETED' THEN 1 END) AS tx_count
       FROM payment_gateways g
       LEFT JOIN transactions t ON t.gateway_id = g.id
       GROUP BY g.id
       ORDER BY g.priority ASC, g.name ASC`
    )
    .all() as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    code: String(r.code),
    providerType: r.provider_type as GatewayProviderType,
    status: r.status as GatewayStatus,
    feePercent: Number(r.fee_percent),
    fixedFeePaise: Number(r.fixed_fee_paise),
    minAmountPaise: Number(r.min_amount_paise),
    maxAmountPaise: Number(r.max_amount_paise),
    dailyLimitPaise: Number(r.daily_limit_paise),
    settlementSla: String(r.settlement_sla),
    priority: Number(r.priority),
    webhookSecretHint: String(r.webhook_secret_hint),
    totalVolumePaise: Number(r.total_volume_paise),
    totalFeesPaise: Number(r.total_fees_paise),
    transactionCount: Number(r.tx_count),
    updatedAt: String(r.updated_at),
  }));
}

export function createPaymentGateway(
  actor: UserProfile,
  input: {
    name: string;
    code: string;
    providerType: GatewayProviderType;
    status: GatewayStatus;
    feePercent: number;
    fixedFeePaise: number;
    minAmountPaise: number;
    maxAmountPaise: number;
    dailyLimitPaise: number;
    settlementSla: string;
    priority: number;
  }
): PaymentGateway {
  const name = input.name.trim();
  const code = input.code.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '');
  if (!name || code.length < 3) {
    throw new Error('Gateway name and code (min 3 characters) are required.');
  }
  if (input.minAmountPaise < 100 || input.maxAmountPaise < input.minAmountPaise) {
    throw new Error('Invalid min/max deposit limits.');
  }

  const id = generateId('gw');
  const now = new Date().toISOString();
  const hint = `whsec_${code.toLowerCase().slice(0, 3)}_••••${crypto.randomBytes(2).toString('hex')}`;

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO payment_gateways (
        id, name, code, provider_type, status, fee_percent, fixed_fee_paise,
        min_amount_paise, max_amount_paise, daily_limit_paise, settlement_sla,
        priority, webhook_secret_hint, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      name,
      code,
      input.providerType,
      input.status,
      Math.max(0, Math.min(15, Number(input.feePercent))),
      Math.max(0, Math.round(Number(input.fixedFeePaise))),
      Math.round(Number(input.minAmountPaise)),
      Math.round(Number(input.maxAmountPaise)),
      Math.round(Number(input.dailyLimitPaise)),
      input.settlementSla.trim() || 'Instant',
      Math.max(1, Math.round(Number(input.priority) || 10)),
      hint,
      now,
      now
    );

    appendAuditLog({
      eventType: 'GATEWAY_UPDATE',
      actorId: actor.id,
      actorName: actor.displayName,
      gatewayId: id,
      referenceCode: generateRef('GW'),
      amountPaise: 0,
      balanceBeforePaise: actor.balancePaise,
      balanceAfterPaise: actor.balancePaise,
      status: 'COMPLETED',
      metadata: { action: 'CREATED', name, code, providerType: input.providerType, status: input.status, feePercent: input.feePercent },
    });
  });
  tx();

  return listPaymentGateways().find((g) => g.id === id)!;
}

export function updatePaymentGateway(
  actor: UserProfile,
  gatewayId: string,
  patch: Partial<{
    name: string;
    status: GatewayStatus;
    feePercent: number;
    fixedFeePaise: number;
    minAmountPaise: number;
    maxAmountPaise: number;
    dailyLimitPaise: number;
    settlementSla: string;
    priority: number;
  }>
): PaymentGateway {
  const existing = db.prepare('SELECT * FROM payment_gateways WHERE id = ?').get(gatewayId) as Record<string, unknown> | undefined;
  if (!existing) {
    throw new Error('Payment gateway not found.');
  }

  const nextName = patch.name !== undefined ? patch.name.trim() : String(existing.name);
  const nextStatus = patch.status ?? (existing.status as GatewayStatus);
  const nextFeePercent = patch.feePercent !== undefined ? Math.max(0, Math.min(15, Number(patch.feePercent))) : Number(existing.fee_percent);
  const nextFixedFee = patch.fixedFeePaise !== undefined ? Math.max(0, Math.round(Number(patch.fixedFeePaise))) : Number(existing.fixed_fee_paise);
  const nextMin = patch.minAmountPaise !== undefined ? Math.max(100, Math.round(Number(patch.minAmountPaise))) : Number(existing.min_amount_paise);
  const nextMax = patch.maxAmountPaise !== undefined ? Math.max(nextMin, Math.round(Number(patch.maxAmountPaise))) : Number(existing.max_amount_paise);
  const nextDaily = patch.dailyLimitPaise !== undefined ? Math.max(nextMax, Math.round(Number(patch.dailyLimitPaise))) : Number(existing.daily_limit_paise);
  const nextSla = patch.settlementSla !== undefined ? patch.settlementSla.trim() : String(existing.settlement_sla);
  const nextPriority = patch.priority !== undefined ? Math.max(1, Math.round(Number(patch.priority))) : Number(existing.priority);
  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE payment_gateways
       SET name = ?, status = ?, fee_percent = ?, fixed_fee_paise = ?,
           min_amount_paise = ?, max_amount_paise = ?, daily_limit_paise = ?,
           settlement_sla = ?, priority = ?, updated_at = ?
       WHERE id = ?`
    ).run(nextName, nextStatus, nextFeePercent, nextFixedFee, nextMin, nextMax, nextDaily, nextSla, nextPriority, now, gatewayId);

    const freshActor = getUserById(actor.id) ?? actor;
    appendAuditLog({
      eventType: 'GATEWAY_UPDATE',
      actorId: actor.id,
      actorName: actor.displayName,
      gatewayId,
      referenceCode: generateRef('GW'),
      amountPaise: 0,
      balanceBeforePaise: freshActor.balancePaise,
      balanceAfterPaise: freshActor.balancePaise,
      status: 'COMPLETED',
      metadata: {
        action: 'UPDATED',
        gatewayName: nextName,
        previousStatus: existing.status,
        newStatus: nextStatus,
        feePercent: nextFeePercent,
        minAmountPaise: nextMin,
        maxAmountPaise: nextMax,
      },
    });
  });
  tx();

  return listPaymentGateways().find((g) => g.id === gatewayId)!;
}

// Money Deposit through Payment Gateway
export function processMoneyDeposit(input: {
  userId: string;
  gatewayId: string;
  amountPaise: number;
  paymentHandle: string;
  idempotencyKey?: string;
  note?: string;
}): { user: UserProfile; transaction: TransactionRecord; audit: AuditLogEntry } {
  const grossPaise = Math.round(input.amountPaise);
  if (!Number.isFinite(grossPaise) || grossPaise <= 0) {
    throw new Error('Deposit amount must be greater than zero.');
  }
  const handle = input.paymentHandle.trim();
  if (handle.length < 3) {
    throw new Error('Enter a valid payment handle, UPI ID, card reference, or account number.');
  }

  const tx = db.transaction(() => {
    if (input.idempotencyKey) {
      const dup = db
        .prepare('SELECT id FROM transactions WHERE idempotency_key = ?')
        .get(input.idempotencyKey) as { id: string } | undefined;
      if (dup) {
        throw new Error('Duplicate deposit request detected (idempotency guard).');
      }
    }

    const userRow = db.prepare('SELECT * FROM users WHERE id = ?').get(input.userId) as Record<string, unknown> | undefined;
    if (!userRow) throw new Error('User account not found.');

    const gw = db.prepare('SELECT * FROM payment_gateways WHERE id = ?').get(input.gatewayId) as Record<string, unknown> | undefined;
    if (!gw) throw new Error('Selected payment gateway not found.');
    if (gw.status !== 'ACTIVE') {
      throw new Error(`${String(gw.name)} is currently ${String(gw.status).toLowerCase()} and cannot accept deposits.`);
    }

    const minPaise = Number(gw.min_amount_paise);
    const maxPaise = Number(gw.max_amount_paise);
    if (grossPaise < minPaise || grossPaise > maxPaise) {
      throw new Error(
        `Amount must be between ₹${(minPaise / 100).toLocaleString('en-IN')} and ₹${(maxPaise / 100).toLocaleString('en-IN')} for ${String(gw.name)}.`
      );
    }

    const feePaise = Math.round((grossPaise * Number(gw.fee_percent)) / 100) + Number(gw.fixed_fee_paise);
    const netCreditPaise = grossPaise - feePaise;
    if (netCreditPaise <= 0) {
      throw new Error('Deposit amount does not cover gateway processing fee.');
    }

    const beforePaise = Number(userRow.balance_paise);
    const afterPaise = beforePaise + netCreditPaise;
    const txId = generateId('tx');
    const refCode = generateRef('DEP');
    const now = new Date().toISOString();
    const webhookSig = crypto.createHmac('sha256', String(gw.webhook_secret_hint)).update(`${refCode}:${grossPaise}`).digest('hex').slice(0, 16);

    db.prepare('UPDATE users SET balance_paise = ? WHERE id = ?').run(afterPaise, input.userId);

    db.prepare(
      `INSERT INTO transactions (
        id, reference_code, idempotency_key, type, user_id, gateway_id,
        gross_amount_paise, fee_paise, net_amount_paise, status,
        payment_handle, note, created_at
      ) VALUES (?, ?, ?, 'DEPOSIT', ?, ?, ?, ?, ?, 'COMPLETED', ?, ?, ?)`
    ).run(
      txId,
      refCode,
      input.idempotencyKey ?? null,
      input.userId,
      input.gatewayId,
      grossPaise,
      feePaise,
      netCreditPaise,
      handle,
      input.note?.trim() || `Deposit via ${String(gw.name)}`,
      now
    );

    const audit = appendAuditLog({
      eventType: 'DEPOSIT',
      actorId: input.userId,
      actorName: String(userRow.display_name),
      gatewayId: input.gatewayId,
      referenceCode: refCode,
      amountPaise: netCreditPaise,
      feePaise,
      balanceBeforePaise: beforePaise,
      balanceAfterPaise: afterPaise,
      status: 'COMPLETED',
      metadata: {
        gatewayCode: gw.code,
        gatewayName: gw.name,
        providerType: gw.provider_type,
        grossAmountPaise: grossPaise,
        paymentHandle: handle,
        webhookSignature: `sha256=${webhookSig}`,
      },
      createdAt: now,
    });

    const freshUser = getUserById(input.userId)!;
    const transaction: TransactionRecord = {
      id: txId,
      referenceCode: refCode,
      type: 'DEPOSIT',
      userId: input.userId,
      counterpartyId: null,
      counterpartyName: null,
      gatewayId: input.gatewayId,
      gatewayName: String(gw.name),
      tableId: null,
      grossAmountPaise: grossPaise,
      feePaise,
      netAmountPaise: netCreditPaise,
      status: 'COMPLETED',
      paymentHandle: handle,
      note: input.note?.trim() || `Deposit via ${String(gw.name)}`,
      createdAt: now,
    };

    return { user: freshUser, transaction, audit };
  });

  return tx();
}

// Atomic User-to-User Money Transfer ("Mani Transfer")
export function processUserTransfer(input: {
  senderId: string;
  recipientIdentifier: string; // username or user id
  amountPaise: number;
  note?: string;
}): {
  sender: UserProfile;
  recipient: UserProfile;
  transaction: TransactionRecord;
} {
  const amountPaise = Math.round(input.amountPaise);
  if (!Number.isFinite(amountPaise) || amountPaise < 1000) {
    throw new Error('Minimum transfer amount is ₹10.00.');
  }
  if (amountPaise > 25000000) {
    throw new Error('Single transfer limit is ₹2,50,000.00.');
  }

  const tx = db.transaction(() => {
    const senderRow = db.prepare('SELECT * FROM users WHERE id = ?').get(input.senderId) as Record<string, unknown> | undefined;
    if (!senderRow) throw new Error('Sender account not found.');

    const cleanTarget = input.recipientIdentifier.trim().toLowerCase();
    const recipientRow = db
      .prepare('SELECT * FROM users WHERE id = ? OR lower(username) = ? OR lower(email) = ?')
      .get(input.recipientIdentifier.trim(), cleanTarget, cleanTarget) as Record<string, unknown> | undefined;

    if (!recipientRow) {
      throw new Error('Recipient user not found. Check username or select from directory.');
    }
    if (String(recipientRow.id) === input.senderId) {
      throw new Error('Cannot transfer funds to your own account.');
    }

    const senderBefore = Number(senderRow.balance_paise);
    if (senderBefore < amountPaise) {
      throw new Error('Insufficient available wallet balance for this transfer.');
    }

    const recipientBefore = Number(recipientRow.balance_paise);
    const senderAfter = senderBefore - amountPaise;
    const recipientAfter = recipientBefore + amountPaise;
    const now = new Date().toISOString();
    const refCode = generateRef('TRF');
    const txId = generateId('tx');
    const cleanNote = input.note?.trim() || 'Player-to-player wallet transfer';

    db.prepare('UPDATE users SET balance_paise = ? WHERE id = ?').run(senderAfter, input.senderId);
    db.prepare('UPDATE users SET balance_paise = ? WHERE id = ?').run(recipientAfter, String(recipientRow.id));

    db.prepare(
      `INSERT INTO transactions (
        id, reference_code, type, user_id, counterparty_id,
        gross_amount_paise, fee_paise, net_amount_paise, status, note, created_at
      ) VALUES (?, ?, 'TRANSFER', ?, ?, ?, 0, ?, 'COMPLETED', ?, ?)`
    ).run(txId, refCode, input.senderId, String(recipientRow.id), amountPaise, amountPaise, cleanNote, now);

    appendAuditLog({
      eventType: 'TRANSFER_OUT',
      actorId: input.senderId,
      actorName: String(senderRow.display_name),
      counterpartyId: String(recipientRow.id),
      counterpartyName: String(recipientRow.display_name),
      referenceCode: refCode,
      amountPaise: -amountPaise,
      balanceBeforePaise: senderBefore,
      balanceAfterPaise: senderAfter,
      status: 'COMPLETED',
      metadata: { note: cleanNote, recipientUsername: recipientRow.username },
      createdAt: now,
    });

    appendAuditLog({
      eventType: 'TRANSFER_IN',
      actorId: String(recipientRow.id),
      actorName: String(recipientRow.display_name),
      counterpartyId: input.senderId,
      counterpartyName: String(senderRow.display_name),
      referenceCode: refCode,
      amountPaise: amountPaise,
      balanceBeforePaise: recipientBefore,
      balanceAfterPaise: recipientAfter,
      status: 'COMPLETED',
      metadata: { note: cleanNote, senderUsername: senderRow.username },
      createdAt: now,
    });

    return {
      sender: getUserById(input.senderId)!,
      recipient: getUserById(String(recipientRow.id))!,
      transaction: {
        id: txId,
        referenceCode: refCode,
        type: 'TRANSFER',
        userId: input.senderId,
        counterpartyId: String(recipientRow.id),
        counterpartyName: String(recipientRow.display_name),
        gatewayId: null,
        gatewayName: null,
        tableId: null,
        grossAmountPaise: amountPaise,
        feePaise: 0,
        netAmountPaise: amountPaise,
        status: 'COMPLETED',
        paymentHandle: `@${String(recipientRow.username)}`,
        note: cleanNote,
        createdAt: now,
      },
    };
  });

  return tx();
}

// Table Cash Escrow & Settlement Operations (Competitive Play)
export function escrowTableBuyIn(userId: string, tableId: string, amountPaise: number, isTopUp = false): UserProfile {
  const amt = Math.round(amountPaise);
  if (amt <= 0) throw new Error('Buy-in amount must be positive.');

  const tx = db.transaction(() => {
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as Record<string, unknown> | undefined;
    if (!row) throw new Error('User not found.');
    const before = Number(row.balance_paise);
    if (before < amt) {
      throw new Error('Insufficient wallet balance. Deposit funds to buy into this table.');
    }
    const after = before - amt;
    const escrowedAfter = Number(row.escrowed_paise) + amt;
    const now = new Date().toISOString();
    const ref = generateRef(isTopUp ? 'TOP' : 'BUY');

    db.prepare('UPDATE users SET balance_paise = ?, escrowed_paise = ? WHERE id = ?').run(after, escrowedAfter, userId);
    db.prepare(
      `INSERT INTO transactions (id, reference_code, type, user_id, table_id, gross_amount_paise, fee_paise, net_amount_paise, status, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, 'COMPLETED', ?, ?)`
    ).run(generateId('tx'), ref, isTopUp ? 'TABLE_TOPUP' : 'TABLE_BUYIN', userId, tableId, amt, amt, isTopUp ? 'Table chip top-up' : 'Table seat buy-in', now);

    appendAuditLog({
      eventType: isTopUp ? 'TABLE_TOPUP' : 'TABLE_BUYIN',
      actorId: userId,
      actorName: String(row.display_name),
      tableId,
      referenceCode: ref,
      amountPaise: -amt,
      balanceBeforePaise: before,
      balanceAfterPaise: after,
      status: 'COMPLETED',
      metadata: { escrowedAfterPaise: escrowedAfter },
      createdAt: now,
    });

    return getUserById(userId)!;
  });

  return tx();
}

export function releaseTableCashOut(userId: string, tableId: string, stackPaise: number): UserProfile {
  const amt = Math.max(0, Math.round(stackPaise));
  const tx = db.transaction(() => {
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as Record<string, unknown> | undefined;
    if (!row) throw new Error('User not found.');
    const before = Number(row.balance_paise);
    const after = before + amt;
    const now = new Date().toISOString();
    const ref = generateRef('OUT');

    db.prepare('UPDATE users SET balance_paise = ?, escrowed_paise = 0 WHERE id = ?').run(after, userId);

    if (amt > 0) {
      db.prepare(
        `INSERT INTO transactions (id, reference_code, type, user_id, table_id, gross_amount_paise, fee_paise, net_amount_paise, status, note, created_at)
         VALUES (?, ?, 'TABLE_CASHOUT', ?, ?, ?, 0, ?, 'COMPLETED', 'Cash out from 3 Patti table', ?)`
      ).run(generateId('tx'), ref, userId, tableId, amt, amt, now);
    }

    appendAuditLog({
      eventType: 'TABLE_CASHOUT',
      actorId: userId,
      actorName: String(row.display_name),
      tableId,
      referenceCode: ref,
      amountPaise: amt,
      balanceBeforePaise: before,
      balanceAfterPaise: after,
      status: 'COMPLETED',
      metadata: { returnedStackPaise: amt },
      createdAt: now,
    });

    return getUserById(userId)!;
  });

  return tx();
}

export function syncUserEscrowAndLogRound(input: {
  tableId: string;
  roundNumber: number;
  winnerUserId: string;
  winnerDisplayName: string;
  winnerIsHouse: boolean;
  potPaise: number;
  rakePaise: number;
  netPayoutPaise: number;
  winningHandLabel: string | null;
  participants: Array<{
    userId: string;
    displayName: string;
    isHouse: boolean;
    contributedPaise: number;
    newStackPaise: number;
  }>;
}): void {
  const tx = db.transaction(() => {
    const now = new Date().toISOString();
    const ref = generateRef('POT');

    for (const p of input.participants) {
      if (p.isHouse) continue;
      const row = db.prepare('SELECT balance_paise, escrowed_paise FROM users WHERE id = ?').get(p.userId) as
        | { balance_paise: number; escrowed_paise: number }
        | undefined;
      if (!row) continue;

      const prevEscrow = Number(row.escrowed_paise);
      db.prepare('UPDATE users SET escrowed_paise = ? WHERE id = ?').run(p.newStackPaise, p.userId);

      const isWinner = p.userId === input.winnerUserId;
      if (isWinner) {
        appendAuditLog({
          eventType: 'GAME_POT_WIN',
          actorId: p.userId,
          actorName: p.displayName,
          tableId: input.tableId,
          referenceCode: ref,
          amountPaise: input.netPayoutPaise - p.contributedPaise,
          feePaise: input.rakePaise,
          balanceBeforePaise: prevEscrow,
          balanceAfterPaise: p.newStackPaise,
          status: 'COMPLETED',
          metadata: {
            roundNumber: input.roundNumber,
            potPaise: input.potPaise,
            rakePaise: input.rakePaise,
            netPayoutPaise: input.netPayoutPaise,
            winningHand: input.winningHandLabel ?? 'All others packed',
            balanceScope: 'table_stack',
          },
          createdAt: now,
        });
      } else if (p.contributedPaise > 0) {
        appendAuditLog({
          eventType: 'GAME_BET',
          actorId: p.userId,
          actorName: p.displayName,
          counterpartyName: input.winnerDisplayName,
          tableId: input.tableId,
          referenceCode: ref,
          amountPaise: -p.contributedPaise,
          balanceBeforePaise: prevEscrow,
          balanceAfterPaise: p.newStackPaise,
          status: 'COMPLETED',
          metadata: {
            roundNumber: input.roundNumber,
            winner: input.winnerDisplayName,
            balanceScope: 'table_stack',
          },
          createdAt: now,
        });
      }
    }
  });
  tx();
}

export function listUserTransactions(userId: string, limit = 30): TransactionRecord[] {
  const rows = db
    .prepare(
      `SELECT t.*, u2.display_name AS counterparty_name, g.name AS gateway_name
       FROM transactions t
       LEFT JOIN users u2 ON u2.id = t.counterparty_id
       LEFT JOIN payment_gateways g ON g.id = t.gateway_id
       WHERE t.user_id = ? OR t.counterparty_id = ?
       ORDER BY t.created_at DESC
       LIMIT ?`
    )
    .all(userId, userId, limit) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: String(r.id),
    referenceCode: String(r.reference_code),
    type: String(r.type),
    userId: String(r.user_id),
    counterpartyId: r.counterparty_id ? String(r.counterparty_id) : null,
    counterpartyName: r.counterparty_name ? String(r.counterparty_name) : null,
    gatewayId: r.gateway_id ? String(r.gateway_id) : null,
    gatewayName: r.gateway_name ? String(r.gateway_name) : null,
    tableId: r.table_id ? String(r.table_id) : null,
    grossAmountPaise: Number(r.gross_amount_paise),
    feePaise: Number(r.fee_paise),
    netAmountPaise: Number(r.net_amount_paise),
    status: String(r.status),
    paymentHandle: r.payment_handle ? String(r.payment_handle) : null,
    note: r.note ? String(r.note) : null,
    createdAt: String(r.created_at),
  }));
}

export function queryAuditLogs(filters: {
  eventType?: string;
  search?: string;
  actorId?: string;
  limit?: number;
}): AuditLogEntry[] {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filters.eventType && filters.eventType !== 'ALL') {
    clauses.push('a.event_type = ?');
    params.push(filters.eventType);
  }
  if (filters.actorId) {
    clauses.push('(a.actor_id = ? OR a.counterparty_id = ?)');
    params.push(filters.actorId, filters.actorId);
  }
  if (filters.search && filters.search.trim().length > 0) {
    const q = `%${filters.search.trim().toLowerCase()}%`;
    clauses.push(
      '(lower(a.actor_name) LIKE ? OR lower(COALESCE(a.counterparty_name, \'\')) LIKE ? OR lower(a.reference_code) LIKE ? OR lower(a.event_type) LIKE ? OR lower(COALESCE(a.table_id, \'\')) LIKE ?)'
    );
    params.push(q, q, q, q, q);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.min(250, Math.max(10, filters.limit ?? 100));
  params.push(limit);

  const rows = db
    .prepare(
      `SELECT a.*, g.name AS gateway_name
       FROM audit_logs a
       LEFT JOIN payment_gateways g ON g.id = a.gateway_id
       ${where}
       ORDER BY a.sequence_no DESC
       LIMIT ?`
    )
    .all(...params) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: String(r.id),
    sequenceNo: Number(r.sequence_no),
    eventType: r.event_type as AuditEventType,
    actorId: String(r.actor_id),
    actorName: String(r.actor_name),
    counterpartyId: r.counterparty_id ? String(r.counterparty_id) : null,
    counterpartyName: r.counterparty_name ? String(r.counterparty_name) : null,
    gatewayId: r.gateway_id ? String(r.gateway_id) : null,
    gatewayName: r.gateway_name ? String(r.gateway_name) : null,
    tableId: r.table_id ? String(r.table_id) : null,
    referenceCode: String(r.reference_code),
    amountPaise: Number(r.amount_paise),
    feePaise: Number(r.fee_paise),
    balanceBeforePaise: Number(r.balance_before_paise),
    balanceAfterPaise: Number(r.balance_after_paise),
    status: String(r.status),
    metadata: JSON.parse(String(r.metadata_json || '{}')) as Record<string, unknown>,
    prevHash: String(r.prev_hash),
    entryHash: String(r.entry_hash),
    createdAt: String(r.created_at),
  }));
}

export function verifyAuditLogChain(): AuditChainVerification {
  const rows = db
    .prepare('SELECT * FROM audit_logs ORDER BY sequence_no ASC')
    .all() as Array<Record<string, unknown>>;

  let expectedPrev = '0'.repeat(64);
  let latestHash: string | null = null;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const seq = Number(r.sequence_no);
    if (String(r.prev_hash) !== expectedPrev) {
      return {
        valid: false,
        totalEntries: rows.length,
        checkedEntries: i + 1,
        brokenAtSequence: seq,
        latestHash,
        verifiedAt: new Date().toISOString(),
      };
    }

    const recomputed = computeAuditHash({
      sequenceNo: seq,
      prevHash: String(r.prev_hash),
      eventType: String(r.event_type),
      actorId: String(r.actor_id),
      amountPaise: Number(r.amount_paise),
      feePaise: Number(r.fee_paise),
      balanceBeforePaise: Number(r.balance_before_paise),
      balanceAfterPaise: Number(r.balance_after_paise),
      referenceCode: String(r.reference_code),
      status: String(r.status),
      metadataJson: String(r.metadata_json),
      createdAt: String(r.created_at),
    });

    if (recomputed !== String(r.entry_hash)) {
      return {
        valid: false,
        totalEntries: rows.length,
        checkedEntries: i + 1,
        brokenAtSequence: seq,
        latestHash,
        verifiedAt: new Date().toISOString(),
      };
    }

    expectedPrev = recomputed;
    latestHash = recomputed;
  }

  return {
    valid: true,
    totalEntries: rows.length,
    checkedEntries: rows.length,
    brokenAtSequence: null,
    latestHash,
    verifiedAt: new Date().toISOString(),
  };
}
