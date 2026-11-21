import type {
  AuditChainVerification,
  AuditLogEntry,
  ClientWsMessage,
  DirectoryUser,
  GatewayProviderType,
  GatewayStatus,
  LobbySnapshot,
  LobbyTableSummary,
  PaymentGateway,
  ServerWsMessage,
  TransactionRecord,
  UserProfile,
} from '../shared/types.ts';

const TOKEN_STORAGE_KEY = 'royal_patti_session_token';

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null): void {
  try {
    if (token) {
      localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

async function apiFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(url, { ...options, headers });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

export const api = {
  login(username: string, password: string) {
    return apiFetch<{ user: UserProfile; token: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
  },
  register(payload: { username: string; displayName: string; email: string; password: string }) {
    return apiFetch<{ user: UserProfile; token: string }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  quickSwitch(username: string) {
    return apiFetch<{ user: UserProfile; token: string }>('/api/auth/quick-switch', {
      method: 'POST',
      body: JSON.stringify({ username }),
    });
  },
  me() {
    return apiFetch<{ user: UserProfile }>('/api/auth/me');
  },
  logout() {
    return apiFetch<{ ok: boolean }>('/api/auth/logout', { method: 'POST' });
  },
  listUsers() {
    return apiFetch<{ users: DirectoryUser[] }>('/api/users');
  },
  walletSummary() {
    return apiFetch<{ user: UserProfile; transactions: TransactionRecord[] }>('/api/wallet/summary');
  },
  deposit(payload: {
    gatewayId: string;
    amountPaise: number;
    paymentHandle: string;
    idempotencyKey: string;
    note?: string;
  }) {
    return apiFetch<{ user: UserProfile; transaction: TransactionRecord; audit: AuditLogEntry }>(
      '/api/wallet/deposit',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );
  },
  transfer(payload: { recipientIdentifier: string; amountPaise: number; note?: string }) {
    return apiFetch<{ sender: UserProfile; recipient: UserProfile; transaction: TransactionRecord }>(
      '/api/wallet/transfer',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );
  },
  listGateways() {
    return apiFetch<{ gateways: PaymentGateway[] }>('/api/gateways');
  },
  createGateway(payload: {
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
  }) {
    return apiFetch<{ gateway: PaymentGateway }>('/api/gateways', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  updateGateway(
    id: string,
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
  ) {
    return apiFetch<{ gateway: PaymentGateway }>(`/api/gateways/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  },
  listAuditLogs(params: { eventType?: string; search?: string; scope?: 'all' | 'mine'; limit?: number }) {
    const q = new URLSearchParams();
    if (params.eventType && params.eventType !== 'ALL') q.set('eventType', params.eventType);
    if (params.search) q.set('search', params.search);
    if (params.scope) q.set('scope', params.scope);
    if (params.limit) q.set('limit', String(params.limit));
    return apiFetch<{ logs: AuditLogEntry[] }>(`/api/audit-logs?${q.toString()}`);
  },
  verifyAuditChain() {
    return apiFetch<AuditChainVerification>('/api/audit-logs/verify');
  },
  getTables() {
    return apiFetch<LobbySnapshot>('/api/tables');
  },
  createTable(payload: {
    name: string;
    bootPaise: number;
    minBuyInPaise: number;
    maxBuyInPaise: number;
    potLimitPaise: number;
    isPrivate: boolean;
  }) {
    return apiFetch<{ table: LobbyTableSummary }>('/api/tables', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
};

export class RealtimeSocket {
  private ws: WebSocket | null = null;
  private token: string | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closedByClient = false;
  private listeners = new Set<(msg: ServerWsMessage) => void>();
  private statusListeners = new Set<(connected: boolean) => void>();

  public connect(token: string): void {
    this.token = token;
    this.closedByClient = false;
    this.openSocket();
  }

  public disconnect(): void {
    this.closedByClient = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.emitStatus(false);
  }

  public send(msg: ClientWsMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  public onMessage(cb: (msg: ServerWsMessage) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  public onStatus(cb: (connected: boolean) => void): () => void {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }

  private emitStatus(connected: boolean): void {
    for (const cb of this.statusListeners) cb(connected);
  }

  private openSocket(): void {
    if (!this.token || this.closedByClient) return;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${window.location.host}/ws?token=${encodeURIComponent(this.token)}`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      this.emitStatus(true);
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as ServerWsMessage;
        for (const cb of this.listeners) cb(msg);
      } catch {
        // ignore malformed frames
      }
    };

    ws.onclose = () => {
      this.emitStatus(false);
      if (!this.closedByClient) {
        this.reconnectTimer = setTimeout(() => {
          this.openSocket();
        }, 1800);
      }
    };

    ws.onerror = () => {
      ws.close();
    };
  }
}

export const realtimeSocket = new RealtimeSocket();
