import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeftRight,
  CheckCircle2,
  CreditCard,
  Download,
  Edit3,
  FileCheck2,
  Plus,
  PlusCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react';
import { api } from '../lib/api.ts';
import { downloadTextFile, formatDateTime, formatPaise, formatPaiseCompact } from '../lib/format.ts';
import { soundEngine } from '../lib/sound.ts';
import type {
  AuditChainVerification,
  AuditLogEntry,
  DirectoryUser,
  GatewayProviderType,
  GatewayStatus,
  PaymentGateway,
  TransactionRecord,
  UserProfile,
} from '../shared/types.ts';
import type { FinancialTab } from './TitleScreen.tsx';

interface FinancialModalProps {
  open: boolean;
  initialTab: FinancialTab;
  user: UserProfile;
  onClose: () => void;
  onUserUpdated: (user: UserProfile) => void;
}

const DEPOSIT_PRESETS_RS = [500, 1000, 2500, 5000, 10000];
const TRANSFER_PRESETS_RS = [250, 500, 1000, 2500, 5000];

const AUDIT_EVENT_FILTERS = [
  'ALL',
  'DEPOSIT',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'TABLE_BUYIN',
  'TABLE_TOPUP',
  'TABLE_CASHOUT',
  'GAME_BET',
  'GAME_POT_WIN',
  'GATEWAY_UPDATE',
];

export function FinancialModal({
  open,
  initialTab,
  user,
  onClose,
  onUserUpdated,
}: FinancialModalProps) {
  const [tab, setTab] = useState<FinancialTab>(initialTab);
  const [gateways, setGateways] = useState<PaymentGateway[]>([]);
  const [users, setUsers] = useState<DirectoryUser[]>([]);
  const [transactions, setTransactions] = useState<TransactionRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [chainVerify, setChainVerify] = useState<AuditChainVerification | null>(null);
  const [loading, setLoading] = useState(false);

  // Deposit state
  const [selectedGatewayId, setSelectedGatewayId] = useState<string>('');
  const [depositRs, setDepositRs] = useState<string>('2500');
  const [paymentHandle, setPaymentHandle] = useState<string>(`${user.username}@okicici`);
  const [depositNote, setDepositNote] = useState<string>('');
  const [depositing, setDepositing] = useState(false);
  const [depositError, setDepositError] = useState<string | null>(null);
  const [depositReceipt, setDepositReceipt] = useState<TransactionRecord | null>(null);

  // Transfer state
  const [recipientInput, setRecipientInput] = useState<string>('');
  const [transferRs, setTransferRs] = useState<string>('1000');
  const [transferNote, setTransferNote] = useState<string>('');
  const [transferring, setTransferring] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [transferReceipt, setTransferReceipt] = useState<TransactionRecord | null>(null);

  // Gateway CRUD state
  const [editingGwId, setEditingGwId] = useState<string | null>(null);
  const [editFeePct, setEditFeePct] = useState<string>('0');
  const [editMinRs, setEditMinRs] = useState<string>('100');
  const [editMaxRs, setEditMaxRs] = useState<string>('100000');
  const [editSla, setEditSla] = useState<string>('Instant');
  const [showAddGw, setShowAddGw] = useState(false);
  const [newGwName, setNewGwName] = useState('');
  const [newGwCode, setNewGwCode] = useState('');
  const [newGwType, setNewGwType] = useState<GatewayProviderType>('UPI');
  const [newGwFeePct, setNewGwFeePct] = useState('0.5');
  const [newGwMinRs, setNewGwMinRs] = useState('100');
  const [newGwMaxRs, setNewGwMaxRs] = useState('100000');
  const [gwError, setGwError] = useState<string | null>(null);

  // Audit filter & detail state
  const [auditFilter, setAuditFilter] = useState<string>('ALL');
  const [auditScope, setAuditScope] = useState<'all' | 'mine'>('all');
  const [auditSearch, setAuditSearch] = useState<string>('');
  const [expandedAuditId, setExpandedAuditId] = useState<string | null>(null);
  const [verifyingChain, setVerifyingChain] = useState(false);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab, open]);

  useEffect(() => {
    setPaymentHandle(`${user.username}@okicici`);
  }, [user.username]);

  const loadFinanceData = useCallback(async () => {
    setLoading(true);
    try {
      const [gwRes, userRes, walletRes] = await Promise.all([
        api.listGateways(),
        api.listUsers(),
        api.walletSummary(),
      ]);
      setGateways(gwRes.gateways);
      setUsers(userRes.users.filter((u) => u.id !== user.id));
      setTransactions(walletRes.transactions);
      onUserUpdated(walletRes.user);

      setSelectedGatewayId((prev) => {
        if (prev && gwRes.gateways.some((g) => g.id === prev && g.status === 'ACTIVE')) {
          return prev;
        }
        return gwRes.gateways.find((g) => g.status === 'ACTIVE')?.id ?? '';
      });
    } catch {
      // handled per-action
    } finally {
      setLoading(false);
    }
  }, [user.id, onUserUpdated]);

  const loadAuditData = useCallback(async () => {
    try {
      const res = await api.listAuditLogs({
        eventType: auditFilter,
        search: auditSearch,
        scope: auditScope,
        limit: 120,
      });
      setAuditLogs(res.logs);
    } catch {
      // ignore
    }
  }, [auditFilter, auditSearch, auditScope]);

  useEffect(() => {
    if (!open) return;
    loadFinanceData();
  }, [open, loadFinanceData]);

  useEffect(() => {
    if (!open) return;
    if (tab === 'audit') {
      loadAuditData();
    }
  }, [open, tab, loadAuditData]);

  // ESC closes modal
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const activeGateway = useMemo(
    () => gateways.find((g) => g.id === selectedGatewayId) ?? null,
    [gateways, selectedGatewayId]
  );

  const depositPreview = useMemo(() => {
    const grossPaise = Math.max(0, Math.round(Number(depositRs || 0) * 100));
    if (!activeGateway) {
      return { grossPaise, feePaise: 0, netPaise: grossPaise };
    }
    const feePaise =
      Math.round((grossPaise * activeGateway.feePercent) / 100) + activeGateway.fixedFeePaise;
    return {
      grossPaise,
      feePaise,
      netPaise: Math.max(0, grossPaise - feePaise),
    };
  }, [depositRs, activeGateway]);

  if (!open) return null;

  const handleDepositSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeGateway) {
      setDepositError('Select an active payment gateway.');
      return;
    }
    setDepositing(true);
    setDepositError(null);
    setDepositReceipt(null);
    try {
      const idempotencyKey = `dep_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      const res = await api.deposit({
        gatewayId: activeGateway.id,
        amountPaise: depositPreview.grossPaise,
        paymentHandle,
        idempotencyKey,
        note: depositNote || undefined,
      });
      soundEngine.playCashSettled();
      onUserUpdated(res.user);
      setDepositReceipt(res.transaction);
      setDepositNote('');
      await loadFinanceData();
    } catch (err) {
      setDepositError(err instanceof Error ? err.message : 'Deposit failed.');
    } finally {
      setDepositing(false);
    }
  };

  const handleTransferSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTransferring(true);
    setTransferError(null);
    setTransferReceipt(null);
    try {
      const amountPaise = Math.round(Number(transferRs || 0) * 100);
      const res = await api.transfer({
        recipientIdentifier: recipientInput,
        amountPaise,
        note: transferNote || undefined,
      });
      soundEngine.playCashSettled();
      onUserUpdated(res.sender);
      setTransferReceipt(res.transaction);
      setTransferNote('');
      await loadFinanceData();
    } catch (err) {
      setTransferError(err instanceof Error ? err.message : 'Transfer failed.');
    } finally {
      setTransferring(false);
    }
  };

  const handleGatewayStatusChange = async (gw: PaymentGateway, status: GatewayStatus) => {
    setGwError(null);
    try {
      await api.updateGateway(gw.id, { status });
      await loadFinanceData();
    } catch (err) {
      setGwError(err instanceof Error ? err.message : 'Unable to update gateway.');
    }
  };

  const startEditGateway = (gw: PaymentGateway) => {
    setEditingGwId(gw.id);
    setEditFeePct(String(gw.feePercent));
    setEditMinRs(String(Math.round(gw.minAmountPaise / 100)));
    setEditMaxRs(String(Math.round(gw.maxAmountPaise / 100)));
    setEditSla(gw.settlementSla);
    setGwError(null);
  };

  const saveEditGateway = async (gwId: string) => {
    setGwError(null);
    try {
      await api.updateGateway(gwId, {
        feePercent: Number(editFeePct),
        minAmountPaise: Math.round(Number(editMinRs) * 100),
        maxAmountPaise: Math.round(Number(editMaxRs) * 100),
        settlementSla: editSla,
      });
      setEditingGwId(null);
      await loadFinanceData();
    } catch (err) {
      setGwError(err instanceof Error ? err.message : 'Failed to save gateway settings.');
    }
  };

  const handleCreateGateway = async (e: React.FormEvent) => {
    e.preventDefault();
    setGwError(null);
    try {
      await api.createGateway({
        name: newGwName,
        code: newGwCode,
        providerType: newGwType,
        status: 'ACTIVE',
        feePercent: Number(newGwFeePct),
        fixedFeePaise: 0,
        minAmountPaise: Math.round(Number(newGwMinRs) * 100),
        maxAmountPaise: Math.round(Number(newGwMaxRs) * 100),
        dailyLimitPaise: Math.round(Number(newGwMaxRs) * 1000),
        settlementSla: 'Instant',
        priority: gateways.length + 1,
      });
      setShowAddGw(false);
      setNewGwName('');
      setNewGwCode('');
      await loadFinanceData();
    } catch (err) {
      setGwError(err instanceof Error ? err.message : 'Unable to add gateway.');
    }
  };

  const handleVerifyChain = async () => {
    setVerifyingChain(true);
    try {
      const result = await api.verifyAuditChain();
      setChainVerify(result);
    } finally {
      setVerifyingChain(false);
    }
  };

  const exportAuditCsv = () => {
    const headers = [
      'Sequence',
      'Timestamp',
      'Event',
      'Actor',
      'Counterparty',
      'Gateway',
      'Reference',
      'Amount_INR',
      'Fee_INR',
      'Balance_Before_INR',
      'Balance_After_INR',
      'Status',
      'Entry_Hash',
    ];
    const rows = auditLogs.map((l) => [
      l.sequenceNo,
      l.createdAt,
      l.eventType,
      `"${l.actorName.replace(/"/g, '""')}"`,
      `"${(l.counterpartyName ?? '').replace(/"/g, '""')}"`,
      `"${(l.gatewayName ?? '').replace(/"/g, '""')}"`,
      l.referenceCode,
      (l.amountPaise / 100).toFixed(2),
      (l.feePaise / 100).toFixed(2),
      (l.balanceBeforePaise / 100).toFixed(2),
      (l.balanceAfterPaise / 100).toFixed(2),
      l.status,
      l.entryHash,
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    downloadTextFile(`royal-patti-audit-log-${Date.now()}.csv`, csv, 'text/csv;charset=utf-8');
  };

  const exportAuditJson = () => {
    downloadTextFile(
      `royal-patti-audit-log-${Date.now()}.json`,
      JSON.stringify(auditLogs, null, 2),
      'application/json'
    );
  };

  const tabs: Array<{ id: FinancialTab; label: string; icon: typeof PlusCircle }> = [
    { id: 'deposit', label: 'Money Deposit', icon: PlusCircle },
    { id: 'transfer', label: 'Money Transfers', icon: ArrowLeftRight },
    { id: 'gateways', label: 'Payment Gateways', icon: CreditCard },
    { id: 'audit', label: 'Audit Logs', icon: FileCheck2 },
  ];

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Cashier, Transfers, Payment Gateways and Audit Logs"
    >
      <div className="w-full max-w-5xl max-h-[90vh] rounded-xl bg-[#0D1914] border border-[#D4AF37]/28 shadow-[0_28px_70px_rgba(0,0,0,0.75)] flex flex-col overflow-hidden">
        {/* Top Modal Header */}
        <div className="px-6 py-4 border-b border-[#FAF8F2]/10 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-semibold text-[#FAF8F2]">
              Cashier &amp; Settlement Console
            </h2>
            <div className="text-xs text-[#9AA8A1] mt-0.5 font-mono-num">
              {user.displayName} (@{user.username}) · Available{' '}
              <span className="text-[#E5C158] font-semibold">{formatPaise(user.balancePaise)}</span>
              {user.escrowedPaise > 0 && (
                <>
                  {' · '}Table Escrow{' '}
                  <span className="text-[#10B981]">{formatPaise(user.escrowedPaise)}</span>
                </>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-[#9AA8A1] hover:text-[#FAF8F2] hover:bg-[#172820] transition-colors cursor-pointer"
            aria-label="Close Cashier"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Segmented Tab Bar */}
        <div className="px-6 pt-3 pb-0 border-b border-[#FAF8F2]/10 flex items-center gap-1 overflow-x-auto">
          {tabs.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`inline-flex items-center gap-2 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  active
                    ? 'border-[#D4AF37] text-[#F5E3A3]'
                    : 'border-transparent text-[#9AA8A1] hover:text-[#FAF8F2]'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Tab Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* TAB 1: MONEY DEPOSIT */}
          {tab === 'deposit' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <form onSubmit={handleDepositSubmit} className="lg:col-span-7 space-y-5">
                <div>
                  <label className="block text-xs font-medium text-[#B8C4BD] mb-2">
                    1. Select Payment Gateway
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {gateways.map((gw) => {
                      const isActive = gw.status === 'ACTIVE';
                      const isSelected = gw.id === selectedGatewayId;
                      return (
                        <button
                          key={gw.id}
                          type="button"
                          disabled={!isActive}
                          onClick={() => setSelectedGatewayId(gw.id)}
                          className={`p-3 rounded-lg border text-left transition-colors cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed ${
                            isSelected
                              ? 'bg-[#162921] border-[#D4AF37]'
                              : 'bg-[#0A1410] border-[#FAF8F2]/12 hover:border-[#D4AF37]/40'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-[#FAF8F2] truncate">
                              {gw.name}
                            </span>
                            <span className="text-[10px] font-mono-num text-[#9AA8A1]">
                              {gw.providerType}
                            </span>
                          </div>
                          <div className="text-[11px] font-mono-num text-[#9AA8A1] mt-1">
                            Fee {gw.feePercent}%
                            {gw.fixedFeePaise > 0 ? ` + ${formatPaise(gw.fixedFeePaise, false)}` : ''}
                            {' · '}
                            {isActive ? gw.settlementSla : gw.status}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#B8C4BD] mb-2">
                    2. Deposit Amount (INR)
                  </label>
                  <div className="flex flex-wrap gap-2 mb-2.5">
                    {DEPOSIT_PRESETS_RS.map((rs) => (
                      <button
                        key={rs}
                        type="button"
                        onClick={() => setDepositRs(String(rs))}
                        className={`px-3 py-1.5 rounded-md text-xs font-mono-num border transition-colors cursor-pointer ${
                          Number(depositRs) === rs
                            ? 'bg-[#D4AF37]/18 border-[#D4AF37] text-[#F5E3A3]'
                            : 'bg-[#0A1410] border-[#FAF8F2]/12 text-[#C8C3B8] hover:border-[#D4AF37]/40'
                        }`}
                      >
                        ₹{rs.toLocaleString('en-IN')}
                      </button>
                    ))}
                  </div>
                  <input
                    type="number"
                    min={100}
                    step={50}
                    required
                    value={depositRs}
                    onChange={(e) => setDepositRs(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-lg bg-[#0A1410] border border-[#FAF8F2]/15 text-sm font-mono-num text-[#FAF8F2] focus:outline-none focus:border-[#D4AF37]"
                  />
                  {activeGateway && (
                    <p className="text-[11px] font-mono-num text-[#87968E] mt-1">
                      Gateway limit: {formatPaiseCompact(activeGateway.minAmountPaise)} –{' '}
                      {formatPaiseCompact(activeGateway.maxAmountPaise)}
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-[#B8C4BD] mb-1.5">
                      Payment Handle / Account Ref
                    </label>
                    <input
                      type="text"
                      required
                      value={paymentHandle}
                      onChange={(e) => setPaymentHandle(e.target.value)}
                      placeholder="name@upi or Visa •••• 4242"
                      className="w-full px-3 py-2 rounded-lg bg-[#0A1410] border border-[#FAF8F2]/15 text-xs text-[#FAF8F2] focus:outline-none focus:border-[#D4AF37]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#B8C4BD] mb-1.5">
                      Reference Note (Optional)
                    </label>
                    <input
                      type="text"
                      value={depositNote}
                      onChange={(e) => setDepositNote(e.target.value)}
                      placeholder="Salon session bankroll"
                      className="w-full px-3 py-2 rounded-lg bg-[#0A1410] border border-[#FAF8F2]/15 text-xs text-[#FAF8F2] focus:outline-none focus:border-[#D4AF37]"
                    />
                  </div>
                </div>

                {depositError && (
                  <p className="text-xs text-[#F87171]">{depositError}</p>
                )}

                <button
                  type="submit"
                  disabled={depositing || !activeGateway}
                  className="w-full py-3 rounded-lg bg-[#D4AF37] hover:bg-[#E3C152] text-[#09120E] font-semibold text-xs tracking-wide transition-colors cursor-pointer disabled:opacity-45"
                >
                  {depositing
                    ? 'Authorizing with Gateway...'
                    : `Authorize & Credit ${formatPaise(depositPreview.netPaise)}`}
                </button>
              </form>

              {/* Right Column: Fee Summary + Instant Receipt + Recent Activity */}
              <div className="lg:col-span-5 space-y-5">
                <div className="rounded-xl bg-[#0A1410] border border-[#FAF8F2]/10 p-4 space-y-2.5 text-xs">
                  <div className="font-semibold text-[#FAF8F2]">Settlement Breakdown</div>
                  <div className="flex justify-between text-[#9AA8A1]">
                    <span>Gross Deposit</span>
                    <span className="font-mono-num text-[#FAF8F2]">
                      {formatPaise(depositPreview.grossPaise)}
                    </span>
                  </div>
                  <div className="flex justify-between text-[#9AA8A1]">
                    <span>
                      Gateway Fee ({activeGateway ? `${activeGateway.feePercent}%` : '0%'})
                    </span>
                    <span className="font-mono-num text-[#E5C158]">
                      -{formatPaise(depositPreview.feePaise)}
                    </span>
                  </div>
                  <div className="pt-2 border-t border-[#FAF8F2]/10 flex justify-between font-semibold">
                    <span className="text-[#FAF8F2]">Net Wallet Credit</span>
                    <span className="font-mono-num text-[#10B981]">
                      {formatPaise(depositPreview.netPaise)}
                    </span>
                  </div>
                </div>

                {depositReceipt && (
                  <div className="rounded-xl bg-[#0E241B] border border-[#10B981]/40 p-4 space-y-1.5 text-xs">
                    <div className="flex items-center gap-2 font-semibold text-[#6EE7B7]">
                      <CheckCircle2 className="w-4 h-4" />
                      Deposit Settled &amp; Audited
                    </div>
                    <div className="font-mono-num text-[#FAF8F2]">
                      Ref {depositReceipt.referenceCode} · +{formatPaise(depositReceipt.netAmountPaise)}
                    </div>
                    <div className="text-[#9FD3BC]">
                      {depositReceipt.gatewayName} · {depositReceipt.paymentHandle}
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <div className="text-xs font-medium text-[#9AA8A1]">Recent Cashier Transactions</div>
                  <div className="divide-y divide-[#FAF8F2]/8 border border-[#FAF8F2]/10 rounded-xl bg-[#0A1410] max-h-52 overflow-y-auto">
                    {transactions.slice(0, 8).map((tx) => (
                      <div key={tx.id} className="px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs">
                        <div className="min-w-0">
                          <div className="font-medium text-[#FAF8F2] truncate">
                            {tx.type.replace('_', ' ')}
                            {tx.gatewayName ? ` · ${tx.gatewayName}` : ''}
                            {tx.counterpartyName ? ` · ${tx.counterpartyName}` : ''}
                          </div>
                          <div className="text-[11px] font-mono-num text-[#7F8E86]">
                            {tx.referenceCode} · {formatDateTime(tx.createdAt)}
                          </div>
                        </div>
                        <div className="font-mono-num font-semibold text-[#E5C158] shrink-0">
                          {formatPaise(tx.netAmountPaise)}
                        </div>
                      </div>
                    ))}
                    {transactions.length === 0 && !loading && (
                      <div className="p-4 text-xs text-[#7F8E86] text-center">No transactions yet.</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: USER-TO-USER MONEY TRANSFERS */}
          {tab === 'transfer' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <form onSubmit={handleTransferSubmit} className="lg:col-span-7 space-y-5">
                <div>
                  <label className="block text-xs font-medium text-[#B8C4BD] mb-2">
                    Select Registered Player
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {users.map((u) => {
                      const selected = recipientInput.toLowerCase() === u.username.toLowerCase();
                      return (
                        <button
                          key={u.id}
                          type="button"
                          onClick={() => setRecipientInput(u.username)}
                          className={`p-3 rounded-lg border text-left transition-colors cursor-pointer ${
                            selected
                              ? 'bg-[#162921] border-[#D4AF37]'
                              : 'bg-[#0A1410] border-[#FAF8F2]/12 hover:border-[#D4AF37]/40'
                          }`}
                        >
                          <div className="text-xs font-semibold text-[#FAF8F2]">{u.displayName}</div>
                          <div className="text-[11px] font-mono-num text-[#8F9E96] mt-0.5">
                            @{u.username}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#B8C4BD] mb-1.5">
                    Recipient Username or Email
                  </label>
                  <input
                    type="text"
                    required
                    value={recipientInput}
                    onChange={(e) => setRecipientInput(e.target.value)}
                    placeholder="e.g. priya, kabir, or email"
                    className="w-full px-3.5 py-2.5 rounded-lg bg-[#0A1410] border border-[#FAF8F2]/15 text-sm text-[#FAF8F2] focus:outline-none focus:border-[#D4AF37]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#B8C4BD] mb-2">
                    Transfer Amount (INR · Zero Fee)
                  </label>
                  <div className="flex flex-wrap gap-2 mb-2.5">
                    {TRANSFER_PRESETS_RS.map((rs) => (
                      <button
                        key={rs}
                        type="button"
                        onClick={() => setTransferRs(String(rs))}
                        className={`px-3 py-1.5 rounded-md text-xs font-mono-num border transition-colors cursor-pointer ${
                          Number(transferRs) === rs
                            ? 'bg-[#D4AF37]/18 border-[#D4AF37] text-[#F5E3A3]'
                            : 'bg-[#0A1410] border-[#FAF8F2]/12 text-[#C8C3B8]'
                        }`}
                      >
                        ₹{rs.toLocaleString('en-IN')}
                      </button>
                    ))}
                  </div>
                  <input
                    type="number"
                    min={10}
                    max={250000}
                    step={10}
                    required
                    value={transferRs}
                    onChange={(e) => setTransferRs(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-lg bg-[#0A1410] border border-[#FAF8F2]/15 text-sm font-mono-num text-[#FAF8F2] focus:outline-none focus:border-[#D4AF37]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#B8C4BD] mb-1.5">
                    Transfer Memo (Recorded in Audit Ledger)
                  </label>
                  <input
                    type="text"
                    value={transferNote}
                    onChange={(e) => setTransferNote(e.target.value)}
                    placeholder="Split table buy-in / settlement"
                    className="w-full px-3.5 py-2 rounded-lg bg-[#0A1410] border border-[#FAF8F2]/15 text-xs text-[#FAF8F2] focus:outline-none focus:border-[#D4AF37]"
                  />
                </div>

                {transferError && <p className="text-xs text-[#F87171]">{transferError}</p>}

                <button
                  type="submit"
                  disabled={transferring || !recipientInput.trim()}
                  className="w-full py-3 rounded-lg bg-[#D4AF37] hover:bg-[#E3C152] text-[#09120E] font-semibold text-xs tracking-wide transition-colors cursor-pointer disabled:opacity-45"
                >
                  {transferring
                    ? 'Executing Atomic Transfer...'
                    : `Send ₹${Number(transferRs || 0).toLocaleString('en-IN')} Now`}
                </button>
              </form>

              <div className="lg:col-span-5 space-y-4">
                <div className="rounded-xl bg-[#0A1410] border border-[#FAF8F2]/10 p-4 space-y-2 text-xs">
                  <div className="font-semibold text-[#FAF8F2]">Atomic Double-Entry Settlement</div>
                  <p className="text-[#94A39B] leading-relaxed">
                    Player-to-player transfers debit your available wallet and credit the recipient
                    inside one SQLite transaction, push a live WebSocket balance update, and append
                    two SHA-256 hash-chained audit entries.
                  </p>
                  <div className="pt-2 border-t border-[#FAF8F2]/8 flex justify-between font-mono-num">
                    <span className="text-[#94A39B]">Transferable Balance</span>
                    <span className="text-[#E5C158] font-semibold">
                      {formatPaise(user.balancePaise)}
                    </span>
                  </div>
                </div>

                {transferReceipt && (
                  <div className="rounded-xl bg-[#0E241B] border border-[#10B981]/40 p-4 space-y-1.5 text-xs">
                    <div className="flex items-center gap-2 font-semibold text-[#6EE7B7]">
                      <CheckCircle2 className="w-4 h-4" />
                      Transfer Completed
                    </div>
                    <div className="font-mono-num text-[#FAF8F2]">
                      Ref {transferReceipt.referenceCode} · {formatPaise(transferReceipt.netAmountPaise)}
                    </div>
                    <div className="text-[#9FD3BC]">
                      Sent to {transferReceipt.counterpartyName} ({transferReceipt.paymentHandle})
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <div className="text-xs font-medium text-[#9AA8A1]">Recent Transfers</div>
                  <div className="divide-y divide-[#FAF8F2]/8 border border-[#FAF8F2]/10 rounded-xl bg-[#0A1410] max-h-56 overflow-y-auto">
                    {transactions
                      .filter((t) => t.type === 'TRANSFER')
                      .slice(0, 8)
                      .map((tx) => {
                        const isOutgoing = tx.userId === user.id;
                        return (
                          <div
                            key={tx.id}
                            className="px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs"
                          >
                            <div className="min-w-0">
                              <div className="font-medium text-[#FAF8F2] truncate">
                                {isOutgoing
                                  ? `To ${tx.counterpartyName ?? 'Player'}`
                                  : 'Incoming Transfer'}
                              </div>
                              <div className="text-[11px] font-mono-num text-[#7F8E86]">
                                {tx.referenceCode} · {formatDateTime(tx.createdAt)}
                              </div>
                            </div>
                            <span
                              className={`font-mono-num font-semibold shrink-0 ${
                                isOutgoing ? 'text-[#FCA5A5]' : 'text-[#6EE7B7]'
                              }`}
                            >
                              {isOutgoing ? '-' : '+'}
                              {formatPaise(tx.netAmountPaise)}
                            </span>
                          </div>
                        );
                      })}
                    {transactions.filter((t) => t.type === 'TRANSFER').length === 0 && (
                      <div className="p-4 text-xs text-[#7F8E86] text-center">
                        No transfers recorded yet.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: PAYMENT GATEWAY MANAGEMENT */}
          {tab === 'gateways' && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-[#FAF8F2]">
                    Payment Rail Routing &amp; Fee Configuration
                  </h3>
                  <p className="text-xs text-[#94A39B] mt-0.5">
                    Toggle availability, adjust processing fees and deposit limits, or provision a
                    new gateway. All edits are logged in the immutable audit chain.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAddGw((s) => !s)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#162921] hover:bg-[#1E372D] border border-[#D4AF37]/35 text-xs font-medium text-[#F5E3A3] cursor-pointer whitespace-nowrap"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Payment Gateway
                </button>
              </div>

              {gwError && <p className="text-xs text-[#F87171]">{gwError}</p>}

              {showAddGw && (
                <form
                  onSubmit={handleCreateGateway}
                  className="rounded-xl bg-[#0A1410] border border-[#D4AF37]/30 p-4 space-y-4"
                >
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[11px] text-[#9AA8A1] mb-1">Gateway Name</label>
                      <input
                        type="text"
                        required
                        value={newGwName}
                        onChange={(e) => setNewGwName(e.target.value)}
                        placeholder="Cashfree UPI Turbo"
                        className="w-full px-3 py-2 rounded bg-[#0E1B16] border border-[#FAF8F2]/15 text-xs text-[#FAF8F2]"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-[#9AA8A1] mb-1">Gateway Code</label>
                      <input
                        type="text"
                        required
                        value={newGwCode}
                        onChange={(e) => setNewGwCode(e.target.value.toUpperCase())}
                        placeholder="CF_UPI"
                        className="w-full px-3 py-2 rounded bg-[#0E1B16] border border-[#FAF8F2]/15 text-xs font-mono-num text-[#FAF8F2]"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-[#9AA8A1] mb-1">Provider Rail</label>
                      <select
                        value={newGwType}
                        onChange={(e) => setNewGwType(e.target.value as GatewayProviderType)}
                        className="w-full px-3 py-2 rounded bg-[#0E1B16] border border-[#FAF8F2]/15 text-xs text-[#FAF8F2]"
                      >
                        <option value="UPI">UPI</option>
                        <option value="CARD">CARD</option>
                        <option value="BANK_TRANSFER">BANK_TRANSFER</option>
                        <option value="WALLET">WALLET</option>
                        <option value="CRYPTO">CRYPTO</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] text-[#9AA8A1] mb-1">Fee (%)</label>
                      <input
                        type="number"
                        step="0.05"
                        min="0"
                        max="15"
                        value={newGwFeePct}
                        onChange={(e) => setNewGwFeePct(e.target.value)}
                        className="w-full px-3 py-2 rounded bg-[#0E1B16] border border-[#FAF8F2]/15 text-xs font-mono-num text-[#FAF8F2]"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-[#9AA8A1] mb-1">Min Deposit (₹)</label>
                      <input
                        type="number"
                        min="10"
                        value={newGwMinRs}
                        onChange={(e) => setNewGwMinRs(e.target.value)}
                        className="w-full px-3 py-2 rounded bg-[#0E1B16] border border-[#FAF8F2]/15 text-xs font-mono-num text-[#FAF8F2]"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-[#9AA8A1] mb-1">Max Deposit (₹)</label>
                      <input
                        type="number"
                        min="100"
                        value={newGwMaxRs}
                        onChange={(e) => setNewGwMaxRs(e.target.value)}
                        className="w-full px-3 py-2 rounded bg-[#0E1B16] border border-[#FAF8F2]/15 text-xs font-mono-num text-[#FAF8F2]"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShowAddGw(false)}
                      className="px-3 py-1.5 text-xs text-[#9AA8A1] hover:text-[#FAF8F2] cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-1.5 rounded bg-[#D4AF37] text-[#09120E] font-semibold text-xs cursor-pointer"
                    >
                      Save Gateway
                    </button>
                  </div>
                </form>
              )}

              <div className="space-y-3">
                {gateways.map((gw) => {
                  const isEditing = editingGwId === gw.id;
                  return (
                    <div
                      key={gw.id}
                      className="rounded-xl bg-[#0A1410] border border-[#FAF8F2]/10 p-4 space-y-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                          <div className="flex items-center gap-2.5">
                            <span className="text-sm font-semibold text-[#FAF8F2]">{gw.name}</span>
                            <span className="text-xs font-mono-num text-[#8D9D95]">
                              {gw.code} · {gw.providerType}
                            </span>
                          </div>
                          <div className="text-xs font-mono-num text-[#98A79F] mt-1">
                            Fee {gw.feePercent}%
                            {gw.fixedFeePaise > 0 ? ` + ${formatPaise(gw.fixedFeePaise, false)}` : ''}
                            {' · '}Range {formatPaiseCompact(gw.minAmountPaise)}–
                            {formatPaiseCompact(gw.maxAmountPaise)}
                            {' · '}SLA {gw.settlementSla}
                            {' · '}Webhook {gw.webhookSecretHint}
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <div className="flex items-center rounded-md bg-[#111E18] p-0.5 border border-[#FAF8F2]/10">
                            {(['ACTIVE', 'MAINTENANCE', 'DISABLED'] as GatewayStatus[]).map((st) => (
                              <button
                                key={st}
                                type="button"
                                onClick={() => handleGatewayStatusChange(gw, st)}
                                className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                                  gw.status === st
                                    ? st === 'ACTIVE'
                                      ? 'bg-[#059669] text-white'
                                      : st === 'MAINTENANCE'
                                        ? 'bg-[#B45309] text-white'
                                        : 'bg-[#991B1B] text-white'
                                    : 'text-[#8E9D95] hover:text-[#FAF8F2]'
                                }`}
                              >
                                {st === 'ACTIVE'
                                  ? 'Active'
                                  : st === 'MAINTENANCE'
                                    ? 'Maintenance'
                                    : 'Disabled'}
                              </button>
                            ))}
                          </div>
                          <button
                            type="button"
                            onClick={() => (isEditing ? setEditingGwId(null) : startEditGateway(gw))}
                            className="p-2 rounded-md bg-[#13221B] border border-[#FAF8F2]/12 text-[#D4AF37] hover:bg-[#1B3026] cursor-pointer"
                            title="Edit fee and limits"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Real SQLite Aggregate Settlement Metrics */}
                      <div className="grid grid-cols-3 gap-4 pt-2.5 border-t border-[#FAF8F2]/8 text-xs">
                        <div>
                          <div className="text-[#7F8E86]">Processed Volume</div>
                          <div className="font-mono-num font-semibold text-[#FAF8F2] mt-0.5">
                            {formatPaise(gw.totalVolumePaise)}
                          </div>
                        </div>
                        <div>
                          <div className="text-[#7F8E86]">Settled Deposits</div>
                          <div className="font-mono-num font-semibold text-[#FAF8F2] mt-0.5">
                            {gw.transactionCount}
                          </div>
                        </div>
                        <div>
                          <div className="text-[#7F8E86]">Fees Collected</div>
                          <div className="font-mono-num font-semibold text-[#E5C158] mt-0.5">
                            {formatPaise(gw.totalFeesPaise)}
                          </div>
                        </div>
                      </div>

                      {isEditing && (
                        <div className="pt-3 border-t border-[#FAF8F2]/10 grid grid-cols-2 sm:grid-cols-5 gap-3 items-end">
                          <div>
                            <label className="block text-[11px] text-[#9AA8A1] mb-1">Fee %</label>
                            <input
                              type="number"
                              step="0.05"
                              value={editFeePct}
                              onChange={(e) => setEditFeePct(e.target.value)}
                              className="w-full px-2.5 py-1.5 rounded bg-[#0E1B16] border border-[#FAF8F2]/15 text-xs font-mono-num text-[#FAF8F2]"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] text-[#9AA8A1] mb-1">Min (₹)</label>
                            <input
                              type="number"
                              value={editMinRs}
                              onChange={(e) => setEditMinRs(e.target.value)}
                              className="w-full px-2.5 py-1.5 rounded bg-[#0E1B16] border border-[#FAF8F2]/15 text-xs font-mono-num text-[#FAF8F2]"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] text-[#9AA8A1] mb-1">Max (₹)</label>
                            <input
                              type="number"
                              value={editMaxRs}
                              onChange={(e) => setEditMaxRs(e.target.value)}
                              className="w-full px-2.5 py-1.5 rounded bg-[#0E1B16] border border-[#FAF8F2]/15 text-xs font-mono-num text-[#FAF8F2]"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] text-[#9AA8A1] mb-1">SLA</label>
                            <input
                              type="text"
                              value={editSla}
                              onChange={(e) => setEditSla(e.target.value)}
                              className="w-full px-2.5 py-1.5 rounded bg-[#0E1B16] border border-[#FAF8F2]/15 text-xs text-[#FAF8F2]"
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => saveEditGateway(gw.id)}
                            className="py-1.5 px-3 rounded bg-[#D4AF37] text-[#09120E] font-semibold text-xs cursor-pointer"
                          >
                            Save Changes
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 4: DETAILED IMMUTABLE AUDIT LOGS */}
          {tab === 'audit' && (
            <div className="space-y-4">
              {/* Toolbar: Search, Scope, Event Filter, Verify Chain, Export */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2.5">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-[#7F8E86] absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={auditSearch}
                      onChange={(e) => setAuditSearch(e.target.value)}
                      placeholder="Search actor, ref, table..."
                      className="pl-8 pr-3 py-1.5 rounded-lg bg-[#0A1410] border border-[#FAF8F2]/15 text-xs text-[#FAF8F2] focus:outline-none focus:border-[#D4AF37] w-52"
                    />
                  </div>

                  <select
                    value={auditFilter}
                    onChange={(e) => setAuditFilter(e.target.value)}
                    className="px-3 py-1.5 rounded-lg bg-[#0A1410] border border-[#FAF8F2]/15 text-xs text-[#FAF8F2]"
                  >
                    {AUDIT_EVENT_FILTERS.map((f) => (
                      <option key={f} value={f}>
                        {f === 'ALL' ? 'All Events' : f.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </select>

                  <div className="flex items-center rounded-lg bg-[#0A1410] p-0.5 border border-[#FAF8F2]/12 text-xs">
                    <button
                      type="button"
                      onClick={() => setAuditScope('all')}
                      className={`px-2.5 py-1 rounded cursor-pointer ${
                        auditScope === 'all' ? 'bg-[#1D3027] text-[#FAF8F2]' : 'text-[#8E9D95]'
                      }`}
                    >
                      Ledger Wide
                    </button>
                    <button
                      type="button"
                      onClick={() => setAuditScope('mine')}
                      className={`px-2.5 py-1 rounded cursor-pointer ${
                        auditScope === 'mine' ? 'bg-[#1D3027] text-[#FAF8F2]' : 'text-[#8E9D95]'
                      }`}
                    >
                      My Account
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleVerifyChain}
                    disabled={verifyingChain}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#142720] hover:bg-[#1C362C] border border-[#10B981]/35 text-xs font-medium text-[#6EE7B7] cursor-pointer whitespace-nowrap"
                  >
                    <ShieldCheck className="w-3.5 h-3.5" />
                    {verifyingChain ? 'Verifying...' : 'Verify SHA-256 Chain'}
                  </button>
                  <button
                    type="button"
                    onClick={loadAuditData}
                    className="p-1.5 rounded-lg bg-[#0A1410] border border-[#FAF8F2]/12 text-[#B8C4BD] hover:text-[#FAF8F2] cursor-pointer"
                    title="Refresh audit logs"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={exportAuditCsv}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0A1410] hover:bg-[#15241D] border border-[#FAF8F2]/15 text-xs text-[#D8D3C8] cursor-pointer whitespace-nowrap"
                  >
                    <Download className="w-3.5 h-3.5" />
                    CSV
                  </button>
                  <button
                    type="button"
                    onClick={exportAuditJson}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0A1410] hover:bg-[#15241D] border border-[#FAF8F2]/15 text-xs text-[#D8D3C8] cursor-pointer whitespace-nowrap"
                  >
                    <Download className="w-3.5 h-3.5" />
                    JSON
                  </button>
                </div>
              </div>

              {chainVerify && (
                <div
                  className={`rounded-lg px-4 py-2.5 border text-xs flex flex-wrap items-center justify-between gap-2 ${
                    chainVerify.valid
                      ? 'bg-[#0D231A] border-[#10B981]/40 text-[#A7F3D0]'
                      : 'bg-[#2B1215] border-[#DC2626]/50 text-[#FCA5A5]'
                  }`}
                >
                  <span>
                    {chainVerify.valid
                      ? `Hash Chain Verified · ${chainVerify.checkedEntries}/${chainVerify.totalEntries} immutable entries intact`
                      : `Integrity mismatch detected at sequence #${chainVerify.brokenAtSequence}`}
                  </span>
                  {chainVerify.latestHash && (
                    <span className="font-mono-num text-[11px] opacity-80">
                      Head {chainVerify.latestHash.slice(0, 18)}…
                    </span>
                  )}
                </div>
              )}

              {/* Audit Ledger Table */}
              <div className="rounded-xl border border-[#FAF8F2]/10 bg-[#0A1410] overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-[#FAF8F2]/10 text-[#86968E]">
                      <th className="py-2.5 px-3 font-medium">Seq</th>
                      <th className="py-2.5 px-3 font-medium">Time</th>
                      <th className="py-2.5 px-3 font-medium">Event</th>
                      <th className="py-2.5 px-3 font-medium">Actor / Counterparty</th>
                      <th className="py-2.5 px-3 font-medium">Ref</th>
                      <th className="py-2.5 px-3 font-medium text-right">Amount</th>
                      <th className="py-2.5 px-3 font-medium text-right">Balance After</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#FAF8F2]/6">
                    {auditLogs.map((entry) => {
                      const isExpanded = expandedAuditId === entry.id;
                      return (
                        <tr
                          key={entry.id}
                          onClick={() => setExpandedAuditId(isExpanded ? null : entry.id)}
                          className="hover:bg-[#13221B] transition-colors cursor-pointer align-top"
                        >
                          <td className="py-2.5 px-3 font-mono-num text-[#7E8E86]">
                            #{entry.sequenceNo}
                          </td>
                          <td className="py-2.5 px-3 font-mono-num text-[#9AA8A1] whitespace-nowrap">
                            {formatDateTime(entry.createdAt)}
                          </td>
                          <td className="py-2.5 px-3 font-medium text-[#FAF8F2] whitespace-nowrap">
                            {entry.eventType.replace(/_/g, ' ')}
                            {isExpanded && (
                              <div className="mt-2 p-2.5 rounded bg-[#070F0C] border border-[#FAF8F2]/10 font-mono-num text-[10px] text-[#9AA8A1] space-y-1 max-w-md whitespace-normal break-all">
                                <div>Before: {formatPaise(entry.balanceBeforePaise)} · Fee: {formatPaise(entry.feePaise)}</div>
                                <div>Prev Hash: {entry.prevHash}</div>
                                <div>Entry Hash: {entry.entryHash}</div>
                                <div>Meta: {JSON.stringify(entry.metadata)}</div>
                              </div>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-[#D5D0C5]">
                            <div>{entry.actorName}</div>
                            {(entry.counterpartyName || entry.gatewayName || entry.tableId) && (
                              <div className="text-[11px] text-[#7E8E86]">
                                {entry.counterpartyName
                                  ? `Counterparty: ${entry.counterpartyName}`
                                  : entry.gatewayName
                                    ? `Gateway: ${entry.gatewayName}`
                                    : `Table: ${entry.tableId}`}
                              </div>
                            )}
                          </td>
                          <td className="py-2.5 px-3 font-mono-num text-[#A9B5AE] whitespace-nowrap">
                            {entry.referenceCode}
                          </td>
                          <td
                            className={`py-2.5 px-3 font-mono-num font-semibold text-right whitespace-nowrap ${
                              entry.amountPaise > 0
                                ? 'text-[#6EE7B7]'
                                : entry.amountPaise < 0
                                  ? 'text-[#FCA5A5]'
                                  : 'text-[#9AA8A1]'
                            }`}
                          >
                            {entry.amountPaise > 0 ? '+' : ''}
                            {formatPaise(entry.amountPaise)}
                          </td>
                          <td className="py-2.5 px-3 font-mono-num text-right text-[#E5C158] whitespace-nowrap">
                            {formatPaise(entry.balanceAfterPaise)}
                          </td>
                        </tr>
                      );
                    })}
                    {auditLogs.length === 0 && (
                      <tr>
                        <td colSpan={7} className="py-8 text-center text-[#7E8E86]">
                          No audit entries match your current filter.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-[#7F8E86]">
                Click any row to inspect cryptographic SHA-256 chain hashes, pre/post balances, and
                transaction metadata.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
