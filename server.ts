import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import {
  createPaymentGateway,
  deleteSession,
  getUserByToken,
  listDirectoryUsers,
  listPaymentGateways,
  listUserTransactions,
  loginUser,
  processMoneyDeposit,
  processUserTransfer,
  queryAuditLogs,
  quickSwitchDemoUser,
  registerUser,
  updatePaymentGateway,
  verifyAuditLogChain,
} from './server/db.ts';
import { TeenPattiGameManager } from './server/gameManager.ts';
import type { ClientWsMessage, UserProfile } from './src/shared/types.ts';

const PORT = 3000;
const app = express();
app.use(express.json({ limit: '1mb' }));

const gameManager = new TeenPattiGameManager();

function extractBearerToken(req: express.Request): string | undefined {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    return header.slice(7).trim();
  }
  const qToken = req.query.token;
  if (typeof qToken === 'string' && qToken.length > 0) {
    return qToken;
  }
  return undefined;
}

function requireAuth(req: express.Request, res: express.Response): UserProfile | null {
  const token = extractBearerToken(req);
  const user = getUserByToken(token);
  if (!user) {
    res.status(401).json({ error: 'Authentication required.' });
    return null;
  }
  return user;
}

// --- Auth Endpoints ---
app.post('/api/auth/login', (req, res) => {
  try {
    const { username, password } = req.body as { username?: string; password?: string };
    const result = loginUser(String(username ?? ''), String(password ?? ''));
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Sign-in failed.' });
  }
});

app.post('/api/auth/register', (req, res) => {
  try {
    const body = req.body as {
      username?: string;
      displayName?: string;
      email?: string;
      password?: string;
    };
    const result = registerUser({
      username: String(body.username ?? ''),
      displayName: String(body.displayName ?? ''),
      email: String(body.email ?? ''),
      password: String(body.password ?? ''),
    });
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Registration failed.' });
  }
});

app.post('/api/auth/quick-switch', (req, res) => {
  try {
    const { username } = req.body as { username?: string };
    const result = quickSwitchDemoUser(String(username ?? 'arjun'));
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Unable to switch player.' });
  }
});

app.get('/api/auth/me', (req, res) => {
  const user = requireAuth(req, res);
  if (!user) return;
  res.json({ user });
});

app.post('/api/auth/logout', (req, res) => {
  const token = extractBearerToken(req);
  if (token) deleteSession(token);
  res.json({ ok: true });
});

// --- User Directory (for P2P Money Transfers) ---
app.get('/api/users', (req, res) => {
  const user = requireAuth(req, res);
  if (!user) return;
  res.json({ users: listDirectoryUsers() });
});

// --- Wallet, Deposits & Money Transfers ---
app.get('/api/wallet/summary', (req, res) => {
  const user = requireAuth(req, res);
  if (!user) return;
  const transactions = listUserTransactions(user.id, 40);
  res.json({ user, transactions });
});

app.post('/api/wallet/deposit', (req, res) => {
  const user = requireAuth(req, res);
  if (!user) return;
  try {
    const body = req.body as {
      gatewayId?: string;
      amountPaise?: number;
      paymentHandle?: string;
      idempotencyKey?: string;
      note?: string;
    };
    const result = processMoneyDeposit({
      userId: user.id,
      gatewayId: String(body.gatewayId ?? ''),
      amountPaise: Number(body.amountPaise ?? 0),
      paymentHandle: String(body.paymentHandle ?? ''),
      idempotencyKey: body.idempotencyKey ? String(body.idempotencyKey) : undefined,
      note: body.note ? String(body.note) : undefined,
    });
    gameManager.notifyWalletUpdate(user.id, `Deposit settled · Ref ${result.transaction.referenceCode}`);
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Deposit failed.' });
  }
});

app.post('/api/wallet/transfer', (req, res) => {
  const user = requireAuth(req, res);
  if (!user) return;
  try {
    const body = req.body as {
      recipientIdentifier?: string;
      amountPaise?: number;
      note?: string;
    };
    const result = processUserTransfer({
      senderId: user.id,
      recipientIdentifier: String(body.recipientIdentifier ?? ''),
      amountPaise: Number(body.amountPaise ?? 0),
      note: body.note ? String(body.note) : undefined,
    });
    gameManager.notifyWalletUpdate(
      result.sender.id,
      `Transferred ₹${(result.transaction.netAmountPaise / 100).toLocaleString('en-IN')} to ${result.recipient.displayName}`
    );
    gameManager.notifyWalletUpdate(
      result.recipient.id,
      `Received ₹${(result.transaction.netAmountPaise / 100).toLocaleString('en-IN')} from ${result.sender.displayName}`
    );
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Transfer failed.' });
  }
});

// --- Payment Gateway Management ---
app.get('/api/gateways', (req, res) => {
  const user = requireAuth(req, res);
  if (!user) return;
  res.json({ gateways: listPaymentGateways() });
});

app.post('/api/gateways', (req, res) => {
  const user = requireAuth(req, res);
  if (!user) return;
  try {
    const gateway = createPaymentGateway(user, req.body);
    res.status(201).json({ gateway });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to create gateway.' });
  }
});

app.patch('/api/gateways/:id', (req, res) => {
  const user = requireAuth(req, res);
  if (!user) return;
  try {
    const gateway = updatePaymentGateway(user, req.params.id, req.body);
    res.json({ gateway });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to update gateway.' });
  }
});

// --- Immutable Audit Logs ---
app.get('/api/audit-logs', (req, res) => {
  const user = requireAuth(req, res);
  if (!user) return;
  const eventType = typeof req.query.eventType === 'string' ? req.query.eventType : undefined;
  const search = typeof req.query.search === 'string' ? req.query.search : undefined;
  const scope = typeof req.query.scope === 'string' ? req.query.scope : 'all';
  const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 100;

  const logs = queryAuditLogs({
    eventType,
    search,
    actorId: scope === 'mine' ? user.id : undefined,
    limit,
  });
  res.json({ logs });
});

app.get('/api/audit-logs/verify', (req, res) => {
  const user = requireAuth(req, res);
  if (!user) return;
  res.json(verifyAuditLogChain());
});

// --- Tables & Lobby ---
app.get('/api/tables', (req, res) => {
  res.json(gameManager.getLobbySnapshot());
});

app.post('/api/tables', (req, res) => {
  const user = requireAuth(req, res);
  if (!user) return;
  try {
    const body = req.body as {
      name?: string;
      bootPaise?: number;
      minBuyInPaise?: number;
      maxBuyInPaise?: number;
      potLimitPaise?: number;
      isPrivate?: boolean;
    };
    const table = gameManager.createCustomTable({
      name: String(body.name ?? `${user.displayName}'s Table`),
      bootPaise: Number(body.bootPaise ?? 5000),
      minBuyInPaise: Number(body.minBuyInPaise ?? 50000),
      maxBuyInPaise: Number(body.maxBuyInPaise ?? 1000000),
      potLimitPaise: Number(body.potLimitPaise ?? 1200000),
      isPrivate: Boolean(body.isPrivate),
    });
    res.status(201).json({ table });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Unable to create table.' });
  }
});

// --- HTTP + WebSocket + Vite Setup ---
async function startServer(): Promise<void> {
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url ?? '/ws', `http://${req.headers.host ?? 'localhost:3000'}`);
    const token = url.searchParams.get('token') ?? undefined;
    const user = getUserByToken(token);
    if (!user) {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid session token.' }));
      ws.close(4001, 'Unauthorized');
      return;
    }

    gameManager.registerConnection(user.id, ws);

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw)) as ClientWsMessage;
        switch (msg.type) {
          case 'lobby:subscribe':
            ws.send(JSON.stringify({ type: 'lobby:update', lobby: gameManager.getLobbySnapshot() }));
            break;
          case 'queue:join':
            gameManager.joinQueue(user.id, msg.tierId, msg.buyInPaise);
            break;
          case 'queue:leave':
            gameManager.leaveQueue(user.id);
            break;
          case 'table:join':
            gameManager.joinTable(user.id, msg.tableId, msg.buyInPaise, msg.inviteCode);
            break;
          case 'table:leave':
            gameManager.leaveTable(user.id);
            break;
          case 'table:fill_house':
            gameManager.fillHouseSeats(user.id);
            break;
          case 'table:start_round':
            gameManager.requestManualStart(user.id);
            break;
          case 'table:topup':
            gameManager.topUpTableStack(user.id, msg.amountPaise);
            break;
          case 'game:action':
            gameManager.performGameAction(user.id, msg.action);
            break;
          case 'game:sideshow_response':
            gameManager.respondSideshow(user.id, msg.accept);
            break;
          case 'table:chat':
            gameManager.handleChat(user.id, msg.text);
            break;
        }
      } catch {
        ws.send(JSON.stringify({ type: 'error', message: 'Malformed real-time command.' }));
      }
    });

    ws.on('close', () => {
      gameManager.unregisterConnection(user.id, ws);
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Royal Patti server running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
