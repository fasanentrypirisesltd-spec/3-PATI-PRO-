import { useState } from 'react';
import {
  ArrowLeft,
  ArrowLeftRight,
  CreditCard,
  FileCheck2,
  Lock,
  Plus,
  PlusCircle,
  Users,
  Zap,
} from 'lucide-react';
import { api } from '../lib/api.ts';
import { formatPaise, formatPaiseCompact } from '../lib/format.ts';
import type { LobbySnapshot, LobbyTableSummary, StakesTierId, UserProfile } from '../shared/types.ts';
import { BrandMark } from './BrandMark.tsx';
import type { FinancialTab } from './TitleScreen.tsx';

interface MatchmakingLobbyProps {
  user: UserProfile;
  lobby: LobbySnapshot | null;
  onBackToTitle: () => void;
  onQuickMatch: (tierId: StakesTierId, buyInPaise: number) => void;
  onJoinTable: (tableId: string, buyInPaise: number, inviteCode?: string) => void;
  onOpenFinance: (tab: FinancialTab) => void;
  onOpenAuth: () => void;
}

interface TierCardDef {
  id: Exclude<StakesTierId, 'custom'>;
  name: string;
  subtitle: string;
  bootPaise: number;
  minBuyInPaise: number;
  maxBuyInPaise: number;
  defaultBuyInPaise: number;
  potLimitPaise: number;
}

const TIERS: TierCardDef[] = [
  {
    id: 'classic',
    name: 'Parlor Classic',
    subtitle: 'Fast-paced everyday competitive tables',
    bootPaise: 5000,
    minBuyInPaise: 50000,
    maxBuyInPaise: 1000000,
    defaultBuyInPaise: 200000,
    potLimitPaise: 1200000,
  },
  {
    id: 'salon',
    name: 'High Roller Salon',
    subtitle: 'Elevated stakes with deep chaal limits',
    bootPaise: 25000,
    minBuyInPaise: 250000,
    maxBuyInPaise: 5000000,
    defaultBuyInPaise: 500000,
    potLimitPaise: 6000000,
  },
  {
    id: 'sovereign',
    name: 'VIP Sovereign',
    subtitle: 'Premier club room with reduced 1.5% rake',
    bootPaise: 100000,
    minBuyInPaise: 1000000,
    maxBuyInPaise: 25000000,
    defaultBuyInPaise: 1500000,
    potLimitPaise: 24000000,
  },
];

export function MatchmakingLobby({
  user,
  lobby,
  onBackToTitle,
  onQuickMatch,
  onJoinTable,
  onOpenFinance,
  onOpenAuth,
}: MatchmakingLobbyProps) {
  const [buyIns, setBuyIns] = useState<Record<string, number>>({
    classic: 200000,
    salon: 500000,
    sovereign: 1500000,
  });
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState(`${user.displayName.split(' ')[0]}'s Club Table`);
  const [newBootRs, setNewBootRs] = useState(100);
  const [newPrivate, setNewPrivate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);
  const [inviteInputs, setInviteInputs] = useState<Record<string, string>>({});

  const tables = lobby?.tables ?? [];

  const handleCreateTable = async () => {
    setCreating(true);
    setCreateErr(null);
    try {
      const bootPaise = Math.max(1000, Math.round(newBootRs * 100));
      const minBuyInPaise = bootPaise * 10;
      const maxBuyInPaise = bootPaise * 200;
      const potLimitPaise = bootPaise * 240;
      const res = await api.createTable({
        name: newName,
        bootPaise,
        minBuyInPaise,
        maxBuyInPaise,
        potLimitPaise,
        isPrivate: newPrivate,
      });
      setShowCreate(false);
      const seatBuyIn = Math.min(user.balancePaise, Math.max(minBuyInPaise, bootPaise * 30));
      if (seatBuyIn >= minBuyInPaise) {
        onJoinTable(res.table.id, seatBuyIn, res.table.inviteCode);
      }
    } catch (err) {
      setCreateErr(err instanceof Error ? err.message : 'Unable to create table.');
    } finally {
      setCreating(false);
    }
  };

  const handleJoinExisting = (t: LobbyTableSummary) => {
    const preferred = Math.min(
      t.maxBuyInPaise,
      Math.max(t.minBuyInPaise, Math.min(user.balancePaise, t.minBuyInPaise * 3))
    );
    if (user.balancePaise < t.minBuyInPaise) {
      onOpenFinance('deposit');
      return;
    }
    onJoinTable(t.id, preferred, inviteInputs[t.id]);
  };

  return (
    <div className="min-h-screen w-full bg-[#09120E] text-[#F2EFE9] flex flex-col">
      {/* Compact Parlor Header */}
      <header className="border-b border-[#D4AF37]/15 bg-[#0D1914] px-6 py-3.5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-5">
          <button
            type="button"
            onClick={onBackToTitle}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-[#A9B5AE] hover:text-[#FAF8F2] transition-colors cursor-pointer whitespace-nowrap"
          >
            <ArrowLeft className="w-4 h-4" />
            Title
          </button>
          <span className="text-[#2D3F36]" aria-hidden="true">|</span>
          <BrandMark variant="compact" />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-xs text-[#A9B5AE] mr-2">
            <button
              type="button"
              onClick={() => onOpenFinance('deposit')}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md hover:bg-[#16261F] text-[#E5C158] font-medium transition-colors cursor-pointer whitespace-nowrap"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              Deposit
            </button>
            <button
              type="button"
              onClick={() => onOpenFinance('transfer')}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md hover:bg-[#16261F] text-[#D7D2C6] font-medium transition-colors cursor-pointer whitespace-nowrap"
            >
              <ArrowLeftRight className="w-3.5 h-3.5" />
              Transfer
            </button>
            <button
              type="button"
              onClick={() => onOpenFinance('gateways')}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md hover:bg-[#16261F] text-[#D7D2C6] font-medium transition-colors cursor-pointer whitespace-nowrap"
            >
              <CreditCard className="w-3.5 h-3.5" />
              Gateways
            </button>
            <button
              type="button"
              onClick={() => onOpenFinance('audit')}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md hover:bg-[#16261F] text-[#D7D2C6] font-medium transition-colors cursor-pointer whitespace-nowrap"
            >
              <FileCheck2 className="w-3.5 h-3.5" />
              Audit Log
            </button>
          </div>

          <button
            type="button"
            onClick={onOpenAuth}
            className="flex items-center gap-2.5 px-3.5 py-2 rounded-lg bg-[#14221C] border border-[#D4AF37]/25 hover:border-[#D4AF37]/50 transition-colors cursor-pointer whitespace-nowrap"
          >
            <span className="text-xs font-medium text-[#FAF8F2]">{user.displayName}</span>
            <span className="text-[#54645C]" aria-hidden="true">·</span>
            <span className="font-mono-num text-xs font-semibold text-[#E5C158]">
              {formatPaise(user.balancePaise)}
            </span>
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-8 space-y-10">
        {/* Matchmaking Stakes Tiers */}
        <section className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="font-display text-2xl sm:text-3xl font-semibold text-[#FAF8F2] tracking-tight">
                Real-Time Matchmaking
              </h1>
              <p className="text-sm text-[#9AA8A1] mt-1">
                Select stakes and table cash buy-in to enter an active 3 Patti room immediately.
              </p>
            </div>
            <div className="text-xs text-[#9AA8A1] font-mono-num">
              Available Wallet: <span className="text-[#E5C158] font-semibold">{formatPaise(user.balancePaise)}</span>
              {' · '}
              {lobby?.onlineCount ?? 1} online
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {TIERS.map((tier) => {
              const selectedBuyIn = buyIns[tier.id] ?? tier.defaultBuyInPaise;
              const maxAffordable = Math.min(tier.maxBuyInPaise, Math.max(tier.minBuyInPaise, user.balancePaise));
              const canAfford = user.balancePaise >= tier.minBuyInPaise;
              const seatedCount = tables
                .filter((t) => t.tierId === tier.id)
                .reduce((acc, t) => acc + t.playerCount, 0);

              return (
                <div
                  key={tier.id}
                  className="rounded-xl bg-[#111D18] border border-[#D4AF37]/18 p-5 flex flex-col justify-between gap-5"
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h2 className="font-display text-lg font-semibold text-[#FAF8F2]">
                          {tier.name}
                        </h2>
                        <p className="text-xs text-[#96A59E] mt-0.5">{tier.subtitle}</p>
                      </div>
                      <span className="font-mono-num text-xs text-[#D4AF37] whitespace-nowrap">
                        {seatedCount} seated
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-3 pt-2 border-t border-[#FAF8F2]/8 text-xs">
                      <div>
                        <div className="text-[#86968E]">Boot Ante</div>
                        <div className="font-mono-num text-sm font-semibold text-[#FAF8F2] mt-0.5">
                          {formatPaiseCompact(tier.bootPaise)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[#86968E]">Pot Limit</div>
                        <div className="font-mono-num text-sm font-semibold text-[#FAF8F2] mt-0.5">
                          {formatPaiseCompact(tier.potLimitPaise)}
                        </div>
                      </div>
                    </div>

                    {/* Table Cash Buy-In Slider */}
                    <div className="pt-2 space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-[#A4B2AA]">Table Buy-In</span>
                        <span className="font-mono-num font-semibold text-[#E5C158]">
                          {formatPaise(Math.min(selectedBuyIn, maxAffordable), false)}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={tier.minBuyInPaise}
                        max={maxAffordable}
                        step={tier.bootPaise}
                        disabled={!canAfford}
                        value={Math.min(selectedBuyIn, maxAffordable)}
                        onChange={(e) =>
                          setBuyIns((prev) => ({ ...prev, [tier.id]: Number(e.target.value) }))
                        }
                        className="w-full accent-[#D4AF37] cursor-pointer disabled:opacity-40"
                      />
                      <div className="flex justify-between text-[11px] font-mono-num text-[#7B8B83]">
                        <span>Min {formatPaiseCompact(tier.minBuyInPaise)}</span>
                        <span>Max {formatPaiseCompact(tier.maxBuyInPaise)}</span>
                      </div>
                    </div>
                  </div>

                  {canAfford ? (
                    <button
                      type="button"
                      onClick={() => onQuickMatch(tier.id, Math.min(selectedBuyIn, maxAffordable))}
                      className="w-full py-2.5 px-4 rounded-lg bg-[#D4AF37] hover:bg-[#E3C152] text-[#09120E] font-semibold text-xs tracking-wide transition-colors flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap"
                    >
                      <Zap className="w-3.5 h-3.5" />
                      Quick Match · Sit Down
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onOpenFinance('deposit')}
                      className="w-full py-2.5 px-4 rounded-lg bg-[#1A2A22] hover:bg-[#22362C] border border-[#D4AF37]/30 text-[#E5C158] font-medium text-xs transition-colors cursor-pointer whitespace-nowrap"
                    >
                      Deposit to Unlock ({formatPaiseCompact(tier.minBuyInPaise)} min)
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Active Tables Directory */}
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-xl font-semibold text-[#FAF8F2]">
                Live Tables Directory
              </h2>
              <p className="text-xs text-[#92A199] mt-0.5">
                Join any open seat directly or host a private table with an invite code.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowCreate((s) => !s)}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#15241D] hover:bg-[#1C3027] border border-[#D4AF37]/30 text-xs font-medium text-[#FAF8F2] transition-colors cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-4 h-4 text-[#D4AF37]" />
              Create Custom Table
            </button>
          </div>

          {showCreate && (
            <div className="rounded-xl bg-[#12201A] border border-[#D4AF37]/25 p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs text-[#A5B3AB] mb-1.5">Table Name</label>
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-[#0A1410] border border-[#FAF8F2]/15 text-sm text-[#FAF8F2] focus:outline-none focus:border-[#D4AF37]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#A5B3AB] mb-1.5">Boot Ante (₹)</label>
                  <input
                    type="number"
                    min={10}
                    max={5000}
                    step={10}
                    value={newBootRs}
                    onChange={(e) => setNewBootRs(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-lg bg-[#0A1410] border border-[#FAF8F2]/15 text-sm font-mono-num text-[#FAF8F2] focus:outline-none focus:border-[#D4AF37]"
                  />
                </div>
                <div className="flex items-end pb-1.5">
                  <label className="inline-flex items-center gap-2.5 text-sm text-[#D8D3C8] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newPrivate}
                      onChange={(e) => setNewPrivate(e.target.checked)}
                      className="accent-[#D4AF37] w-4 h-4"
                    />
                    Private table (require invite code)
                  </label>
                </div>
              </div>
              {createErr && <p className="text-xs text-[#F87171]">{createErr}</p>}
              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="px-4 py-2 rounded-lg text-xs text-[#A5B3AB] hover:text-[#FAF8F2] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={creating}
                  onClick={handleCreateTable}
                  className="px-5 py-2 rounded-lg bg-[#D4AF37] hover:bg-[#E2BF4E] text-[#09120E] font-semibold text-xs cursor-pointer disabled:opacity-50"
                >
                  {creating ? 'Opening Table...' : 'Open & Take Seat'}
                </button>
              </div>
            </div>
          )}

          <div className="rounded-xl border border-[#FAF8F2]/10 bg-[#101B16] overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[#FAF8F2]/10 text-xs text-[#8E9D95]">
                  <th className="py-3 px-4 font-medium">Table</th>
                  <th className="py-3 px-4 font-medium">Boot / Min Buy-In</th>
                  <th className="py-3 px-4 font-medium">Pot Limit</th>
                  <th className="py-3 px-4 font-medium">Seats</th>
                  <th className="py-3 px-4 font-medium">State</th>
                  <th className="py-3 px-4 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#FAF8F2]/6">
                {tables.map((t) => (
                  <tr key={t.id} className="hover:bg-[#15241D]/70 transition-colors">
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-2 font-medium text-[#FAF8F2]">
                        {t.isPrivate && <Lock className="w-3.5 h-3.5 text-[#D4AF37]" />}
                        <span>{t.name}</span>
                      </div>
                      {t.inviteCode && (
                        <div className="text-[11px] font-mono-num text-[#9AA8A1] mt-0.5">
                          Code: {t.inviteCode}
                        </div>
                      )}
                    </td>
                    <td className="py-3.5 px-4 font-mono-num text-xs text-[#D8D3C8]">
                      {formatPaiseCompact(t.bootPaise)} / {formatPaiseCompact(t.minBuyInPaise)}
                    </td>
                    <td className="py-3.5 px-4 font-mono-num text-xs text-[#D8D3C8]">
                      {formatPaiseCompact(t.potLimitPaise)}
                    </td>
                    <td className="py-3.5 px-4 font-mono-num text-xs text-[#D8D3C8]">
                      <span className="inline-flex items-center gap-1.5">
                        <Users className="w-3.5 h-3.5 text-[#8A9991]" />
                        {t.playerCount}/{t.maxSeats}
                        {t.humanCount > 0 && (
                          <span className="text-[#10B981]">· {t.humanCount} live</span>
                        )}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-xs text-[#A5B3AB]">
                      {t.phase === 'WAITING'
                        ? 'Open'
                        : t.phase === 'SHOWDOWN'
                          ? 'Showdown'
                          : 'Hand in Progress'}
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <div className="inline-flex items-center gap-2">
                        {t.isPrivate && (
                          <input
                            type="text"
                            placeholder="Code"
                            value={inviteInputs[t.id] ?? ''}
                            onChange={(e) =>
                              setInviteInputs((prev) => ({ ...prev, [t.id]: e.target.value.toUpperCase() }))
                            }
                            className="w-20 px-2 py-1.5 rounded bg-[#0A1410] border border-[#FAF8F2]/15 text-xs font-mono-num text-[#FAF8F2]"
                          />
                        )}
                        <button
                          type="button"
                          onClick={() => handleJoinExisting(t)}
                          disabled={t.playerCount >= t.maxSeats && t.phase !== 'WAITING'}
                          className="px-3.5 py-1.5 rounded-md bg-[#1A2D24] hover:bg-[#D4AF37] hover:text-[#09120E] border border-[#D4AF37]/30 text-xs font-medium text-[#E5C158] transition-colors cursor-pointer disabled:opacity-40 whitespace-nowrap"
                        >
                          {t.playerCount >= t.maxSeats && t.phase !== 'WAITING' ? 'Full' : 'Join Seat'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
