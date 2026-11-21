import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeftRight,
  BookOpen,
  Coins,
  FileCheck2,
  LogOut,
  MessageSquare,
  PlusCircle,
  Send,
  UserPlus,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { formatPaise, formatPaiseCompact, formatShortTime } from '../lib/format.ts';
import { soundEngine } from '../lib/sound.ts';
import type { SeatState, TableSnapshot, UserProfile } from '../shared/types.ts';
import { PlayingCard } from './PlayingCard.tsx';
import type { FinancialTab } from './TitleScreen.tsx';

const FELT_SURFACE = '/src/assets/images/table_felt_surface_1795231707756.jpg';

interface GameTableProps {
  user: UserProfile;
  table: TableSnapshot;
  muted: boolean;
  onToggleMute: () => void;
  onAction: (action: 'see' | 'blind' | 'chaal' | 'raise' | 'pack' | 'show' | 'sideshow_request') => void;
  onSideshowResponse: (accept: boolean) => void;
  onFillHouse: () => void;
  onStartRound: () => void;
  onTopUp: (amountPaise: number) => void;
  onLeaveTable: () => void;
  onSendChat: (text: string) => void;
  onOpenFinance: (tab: FinancialTab) => void;
  onOpenRules: () => void;
}

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

export function GameTable({
  user,
  table,
  muted,
  onToggleMute,
  onAction,
  onSideshowResponse,
  onFillHouse,
  onStartRound,
  onTopUp,
  onLeaveTable,
  onSendChat,
  onOpenFinance,
  onOpenRules,
}: GameTableProps) {
  const [feltErr, setFeltErr] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [feedOpen, setFeedOpen] = useState(false);
  const [topUpOpen, setTopUpOpen] = useState(false);
  const [topUpAmount, setTopUpAmount] = useState(table.config.minBuyInPaise);
  const [chatText, setChatText] = useState('');
  const prevTurnRef = useRef<number | null>(null);
  const prevRoundRef = useRef<number>(table.roundNumber);
  const prevWinnerRef = useRef<number | null>(null);

  // Live countdown ticker for turn timer & next-round timer
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  const mySeatIndex = useMemo(
    () => table.seats.findIndex((s) => s?.userId === user.id),
    [table.seats, user.id]
  );
  const mySeat = mySeatIndex >= 0 ? table.seats[mySeatIndex] : null;

  // Arrange opponents clockwise relative to player's seat so player is always bottom-center
  const orderedOpponents = useMemo(() => {
    const n = table.seats.length;
    const base = mySeatIndex >= 0 ? mySeatIndex : 0;
    const list: Array<{ seat: SeatState | null; seatIndex: number }> = [];
    for (let offset = 1; offset < n; offset++) {
      const idx = (base + offset) % n;
      list.push({ seat: table.seats[idx], seatIndex: idx });
    }
    return list;
  }, [table.seats, mySeatIndex]);

  // Trigger Web Audio feedback on round deal, player turn, and pot win
  useEffect(() => {
    if (table.roundNumber > prevRoundRef.current) {
      soundEngine.playDeal();
      prevRoundRef.current = table.roundNumber;
    }
  }, [table.roundNumber]);

  useEffect(() => {
    if (
      table.currentTurnSeatIndex !== null &&
      table.currentTurnSeatIndex === mySeatIndex &&
      prevTurnRef.current !== mySeatIndex
    ) {
      soundEngine.playTurn();
    }
    prevTurnRef.current = table.currentTurnSeatIndex;
  }, [table.currentTurnSeatIndex, mySeatIndex]);

  useEffect(() => {
    if (table.lastWinner && prevWinnerRef.current !== table.lastWinner.roundNumber) {
      prevWinnerRef.current = table.lastWinner.roundNumber;
      if (table.lastWinner.winnerUserId === user.id) {
        soundEngine.playWin();
      } else {
        soundEngine.playChip();
      }
    }
  }, [table.lastWinner, user.id]);

  // Derived gameplay affordances
  const activeSeats = table.seats.filter((s): s is SeatState => s !== null && s.inRound && !s.isPacked);
  const isMyTurn =
    table.phase === 'BETTING' && mySeat !== null && table.currentTurnSeatIndex === mySeatIndex;
  const canSee =
    (table.phase === 'BETTING' || table.phase === 'SIDESHOW_PENDING') &&
    mySeat !== null &&
    mySeat.inRound &&
    !mySeat.isPacked &&
    !mySeat.isSeen;

  const myCallCost = mySeat
    ? mySeat.isSeen
      ? table.currentStakePaise * 2
      : table.currentStakePaise
    : table.currentStakePaise;

  const raisedUnit = Math.min(table.config.chaalLimitPaise / 2, table.currentStakePaise * 2);
  const myRaiseCost = mySeat ? (mySeat.isSeen ? raisedUnit * 2 : raisedUnit) : raisedUnit;
  const canRaise =
    isMyTurn &&
    mySeat !== null &&
    myRaiseCost > myCallCost &&
    mySeat.stackPaise >= myRaiseCost;

  // Check if Show is legal (2 active players, and if I'm Seen, opponent must also be Seen)
  const otherActive = activeSeats.find((s) => s.seatIndex !== mySeatIndex);
  const canShow =
    isMyTurn &&
    mySeat !== null &&
    activeSeats.length === 2 &&
    otherActive !== undefined &&
    (!mySeat.isSeen || otherActive.isSeen);

  // Check if Sideshow is legal (>2 active players, both I and previous active player are Seen)
  const prevActiveSeat = useMemo(() => {
    if (mySeatIndex < 0) return null;
    const n = table.seats.length;
    for (let offset = 1; offset <= n; offset++) {
      const idx = (mySeatIndex - offset + n) % n;
      const s = table.seats[idx];
      if (s && s.inRound && !s.isPacked) return s;
    }
    return null;
  }, [table.seats, mySeatIndex]);

  const canSideshow =
    isMyTurn &&
    mySeat !== null &&
    mySeat.isSeen &&
    activeSeats.length > 2 &&
    prevActiveSeat !== null &&
    prevActiveSeat.isSeen &&
    mySeat.stackPaise >= myCallCost;

  const incomingSideshow =
    table.phase === 'SIDESHOW_PENDING' &&
    table.sideshow !== null &&
    table.sideshow.toSeatIndex === mySeatIndex;

  // Keyboard shortcuts for snappy play
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
        return;
      }
      const key = e.key.toLowerCase();
      if (key === 's' && canSee) {
        soundEngine.playFlip();
        onAction('see');
      } else if (key === 'c' && isMyTurn && mySeat) {
        soundEngine.playChip();
        onAction(mySeat.isSeen ? 'chaal' : 'blind');
      } else if (key === 'r' && canRaise) {
        soundEngine.playRaise();
        onAction('raise');
      } else if (key === 'h' && canSideshow) {
        soundEngine.playChip();
        onAction('sideshow_request');
      } else if (key === 'p' && isMyTurn) {
        soundEngine.playPack();
        onAction('pack');
      } else if (e.key === ' ' && canShow) {
        e.preventDefault();
        soundEngine.playRaise();
        onAction('show');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [canSee, isMyTurn, mySeat, canRaise, canSideshow, canShow, onAction]);

  const turnSecondsLeft = table.turnDeadline ? Math.max(0, Math.ceil((table.turnDeadline - now) / 1000)) : null;
  const nextRoundSecs = table.nextRoundAt ? Math.max(0, Math.ceil((table.nextRoundAt - now) / 1000)) : null;
  const potProgressPct = Math.min(100, Math.round((table.potPaise / Math.max(1, table.config.potLimitPaise)) * 100));
  const seatedTotal = table.seats.filter((s) => s !== null).length;

  // Opponent anchor positions around the oval arc (4 slots: left, top-left, top-right, right)
  const opponentPositions = [
    'left-4 sm:left-8 top-[42%] -translate-y-1/2',
    'left-[18%] sm:left-[24%] top-[13%]',
    'right-[18%] sm:right-[24%] top-[13%]',
    'right-4 sm:right-8 top-[42%] -translate-y-1/2',
  ];

  const handleChatSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatText.trim()) return;
    onSendChat(chatText.trim());
    setChatText('');
  };

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#07140F] select-none">
      {/* Full-Viewport Felt Table Canvas */}
      {!feltErr ? (
        <img
          src={FELT_SURFACE}
          alt="Emerald baize 3 Patti card table"
          referrerPolicy="no-referrer"
          onError={() => setFeltErr(true)}
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,#14563B_0%,#0B3524_58%,#061810_100%)]" />
      )}

      {/* Subtle mahogany edge vignette */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          boxShadow: 'inset 0 0 110px rgba(4, 10, 8, 0.85)',
        }}
      />

      {/* TOP PERIMETER HUD — pointer-events-none wrapper so felt remains unobstructed */}
      <div className="pointer-events-none absolute top-0 inset-x-0 z-20 flex items-start justify-between px-4 sm:px-6 pt-3.5 gap-4">
        {/* Left cluster: Table identity & rules metadata */}
        <div className="pointer-events-auto flex items-center gap-3 px-3.5 py-2 rounded-lg bg-[#0C1713]/88 border border-[#D4AF37]/22">
          <div>
            <div className="text-xs font-semibold text-[#FAF8F2] leading-tight">
              {table.config.name}
            </div>
            <div className="text-[11px] font-mono-num text-[#9EACA4] mt-0.5">
              Boot {formatPaiseCompact(table.config.bootPaise)} · Limit {formatPaiseCompact(table.config.potLimitPaise)}
              {table.config.inviteCode ? ` · Code ${table.config.inviteCode}` : ''}
            </div>
          </div>
        </div>

        {/* Right cluster: Live Wallet + Financial Actions + Controls */}
        <div className="pointer-events-auto flex flex-wrap items-center justify-end gap-2">
          <div className="hidden md:flex items-center gap-2.5 px-3 py-2 rounded-lg bg-[#0C1713]/88 border border-[#D4AF37]/22 text-xs">
            <span className="text-[#9AA8A1]">Wallet</span>
            <span className="font-mono-num font-semibold text-[#E5C158]">
              {formatPaise(user.balancePaise)}
            </span>
          </div>

          <button
            type="button"
            onClick={() => setTopUpOpen((o) => !o)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#0C1713]/88 hover:bg-[#162720] border border-[#D4AF37]/25 text-xs font-medium text-[#E5C158] transition-colors cursor-pointer whitespace-nowrap"
            title="Top up table cash from wallet"
          >
            <Coins className="w-3.5 h-3.5" />
            Top-Up
          </button>

          <button
            type="button"
            onClick={() => onOpenFinance('deposit')}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#0C1713]/88 hover:bg-[#162720] border border-[#FAF8F2]/14 text-xs font-medium text-[#FAF8F2] transition-colors cursor-pointer whitespace-nowrap"
          >
            <PlusCircle className="w-3.5 h-3.5 text-[#10B981]" />
            Deposit
          </button>

          <button
            type="button"
            onClick={() => onOpenFinance('transfer')}
            className="hidden sm:inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#0C1713]/88 hover:bg-[#162720] border border-[#FAF8F2]/14 text-xs font-medium text-[#FAF8F2] transition-colors cursor-pointer whitespace-nowrap"
          >
            <ArrowLeftRight className="w-3.5 h-3.5 text-[#D4AF37]" />
            Transfer
          </button>

          <button
            type="button"
            onClick={() => onOpenFinance('audit')}
            className="hidden lg:inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#0C1713]/88 hover:bg-[#162720] border border-[#FAF8F2]/14 text-xs font-medium text-[#FAF8F2] transition-colors cursor-pointer whitespace-nowrap"
          >
            <FileCheck2 className="w-3.5 h-3.5 text-[#D4AF37]" />
            Audit
          </button>

          <button
            type="button"
            onClick={() => setFeedOpen((o) => !o)}
            className={`p-2 rounded-lg border transition-colors cursor-pointer ${
              feedOpen
                ? 'bg-[#D4AF37] text-[#09120E] border-[#D4AF37]'
                : 'bg-[#0C1713]/88 border-[#FAF8F2]/14 text-[#D9D5CA] hover:text-[#FAF8F2]'
            }`}
            title="Table Feed & Chat"
            aria-label="Table Feed & Chat"
          >
            <MessageSquare className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={onOpenRules}
            className="p-2 rounded-lg bg-[#0C1713]/88 border border-[#FAF8F2]/14 text-[#D9D5CA] hover:text-[#FAF8F2] transition-colors cursor-pointer"
            title="3 Patti Rules"
            aria-label="3 Patti Rules"
          >
            <BookOpen className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={onToggleMute}
            className="p-2 rounded-lg bg-[#0C1713]/88 border border-[#FAF8F2]/14 text-[#D9D5CA] hover:text-[#FAF8F2] transition-colors cursor-pointer"
            title={muted ? 'Unmute' : 'Mute'}
            aria-label={muted ? 'Unmute' : 'Mute'}
          >
            {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>

          <button
            type="button"
            onClick={onLeaveTable}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#2B1215]/90 hover:bg-[#3E181D] border border-[#DC2626]/35 text-xs font-medium text-[#FCA5A5] transition-colors cursor-pointer whitespace-nowrap"
            title="Cash out remaining table stack to wallet and leave"
          >
            <LogOut className="w-3.5 h-3.5" />
            Cash Out
          </button>
        </div>
      </div>

      {/* Inline Top-Up Popover */}
      {topUpOpen && mySeat && (
        <div className="absolute top-16 right-6 z-30 w-72 rounded-xl bg-[#101C17] border border-[#D4AF37]/35 p-4 shadow-[0_18px_40px_rgba(0,0,0,0.65)] space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#FAF8F2]">Top-Up Table Stack</span>
            <button
              type="button"
              onClick={() => setTopUpOpen(false)}
              className="text-[#8E9D95] hover:text-[#FAF8F2] cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="text-xs text-[#9AA8A1] flex justify-between font-mono-num">
            <span>Wallet: {formatPaise(user.balancePaise, false)}</span>
            <span>Stack: {formatPaise(mySeat.stackPaise, false)}</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[table.config.bootPaise * 10, table.config.bootPaise * 25, table.config.bootPaise * 50].map(
              (amt) => (
                <button
                  key={amt}
                  type="button"
                  onClick={() => setTopUpAmount(amt)}
                  className={`py-1.5 rounded text-xs font-mono-num border cursor-pointer ${
                    topUpAmount === amt
                      ? 'bg-[#D4AF37]/20 border-[#D4AF37] text-[#F5E3A3]'
                      : 'bg-[#0A1410] border-[#FAF8F2]/12 text-[#C8C3B8]'
                  }`}
                >
                  +{formatPaiseCompact(amt)}
                </button>
              )
            )}
          </div>
          <button
            type="button"
            disabled={user.balancePaise < topUpAmount}
            onClick={() => {
              soundEngine.playCashSettled();
              onTopUp(topUpAmount);
              setTopUpOpen(false);
            }}
            className="w-full py-2 rounded-lg bg-[#D4AF37] hover:bg-[#E3C152] text-[#09120E] font-semibold text-xs cursor-pointer disabled:opacity-40"
          >
            Add {formatPaise(topUpAmount, false)} to Table
          </button>
        </div>
      )}

      {/* 4 OPPONENT SEATS AROUND THE OVAL ARC */}
      {orderedOpponents.map(({ seat, seatIndex }, slotIdx) => {
        const posClass = opponentPositions[slotIdx];
        const isTurn = table.phase === 'BETTING' && table.currentTurnSeatIndex === seatIndex;
        const isDealer = table.dealerSeatIndex === seatIndex;
        const isWinner = table.phase === 'SHOWDOWN' && table.lastWinner?.winnerSeatIndex === seatIndex;

        if (!seat) {
          return (
            <div
              key={seatIndex}
              className={`absolute ${posClass} z-10 w-36 rounded-lg border border-dashed border-[#D4AF37]/22 bg-[#081510]/55 px-3 py-2.5 text-center`}
            >
              <div className="text-[11px] font-medium text-[#7F9489]">Seat {seatIndex + 1} · Open</div>
            </div>
          );
        }

        const showOppCards = seat.cards !== null && seat.cards.length === 3;

        return (
          <div
            key={seatIndex}
            className={`absolute ${posClass} z-10 flex flex-col items-center gap-1.5 transition-opacity ${
              seat.isPacked ? 'opacity-50' : 'opacity-100'
            }`}
          >
            {/* Opponent Cards */}
            {seat.inRound && (
              <div className="flex items-center -space-x-4">
                {[0, 1, 2].map((ci) => (
                  <PlayingCard
                    key={ci}
                    card={showOppCards ? seat.cards![ci] : null}
                    faceUp={showOppCards}
                    size="sm"
                    delayIndex={ci}
                    highlight={isWinner}
                    dimmed={seat.isPacked}
                  />
                ))}
              </div>
            )}

            {/* Seat Nameplate */}
            <div
              className={`min-w-[152px] px-3 py-2 rounded-lg bg-[#0D1A15]/92 border transition-colors ${
                isWinner
                  ? 'border-[#10B981] shadow-[0_0_24px_rgba(16,185,129,0.3)]'
                  : isTurn
                    ? 'border-[#D4AF37] shadow-[0_0_22px_rgba(212,175,55,0.28)]'
                    : 'border-[#FAF8F2]/14'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-6 h-6 rounded-full bg-[#1C3027] border border-[#D4AF37]/35 flex items-center justify-center text-[10px] font-semibold text-[#E5C158] shrink-0">
                    {getInitials(seat.displayName)}
                  </div>
                  <span className="text-xs font-semibold text-[#FAF8F2] truncate max-w-[90px]">
                    {seat.displayName}
                  </span>
                </div>
                {isDealer && (
                  <span className="text-[10px] font-mono-num font-bold text-[#D4AF37]" title="Dealer">
                    D
                  </span>
                )}
              </div>

              <div className="flex items-center justify-between gap-2 mt-1 text-[11px] font-mono-num">
                <span className="text-[#E5C158] font-medium">
                  {formatPaiseCompact(seat.stackPaise)}
                </span>
                <span className="text-[#99A8A0]">
                  {isTurn && turnSecondsLeft !== null
                    ? `Turn · ${turnSecondsLeft}s`
                    : seat.isPacked
                      ? 'Packed'
                      : seat.inRound
                        ? seat.isSeen
                          ? 'Seen'
                          : 'Blind'
                        : 'Waiting'}
                </span>
              </div>

              {seat.lastAction && (
                <div className="text-[10px] text-[#B8C4BD] mt-0.5 truncate">
                  {seat.handEvaluation ? seat.handEvaluation.label : seat.lastAction}
                </div>
              )}
            </div>
          </div>
        );
      })}

      {/* CENTER POT & ROUND STATUS AREA */}
      <div className="absolute left-1/2 top-[46%] -translate-x-1/2 -translate-y-1/2 z-10 flex flex-col items-center text-center max-w-md w-full px-4">
        {table.phase === 'WAITING' && seatedTotal < 2 ? (
          <div className="rounded-xl bg-[#0C1813]/92 border border-[#D4AF37]/30 px-6 py-5 space-y-3.5 shadow-[0_20px_50px_rgba(0,0,0,0.55)]">
            <h2 className="font-display text-lg font-semibold text-[#FAF8F2]">
              Waiting for Players at Table
            </h2>
            <p className="text-xs text-[#A5B4AC] leading-relaxed">
              Real-time matchmaking is active — open a second browser tab to join Seat 2 as another
              player, or seat House challengers to deal immediately.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
              <button
                type="button"
                onClick={onFillHouse}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#D4AF37] hover:bg-[#E3C152] text-[#09120E] font-semibold text-xs transition-colors cursor-pointer whitespace-nowrap"
              >
                <UserPlus className="w-4 h-4" />
                Seat House Challengers &amp; Deal
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2.5 animate-chip">
            {/* Pot readout */}
            <div className="inline-flex flex-col items-center px-6 py-3 rounded-xl bg-[#091611]/82 border border-[#D4AF37]/30">
              <div className="text-[11px] tracking-widest text-[#B9A773]">TOTAL POT</div>
              <div className="font-mono-num text-2xl sm:text-3xl font-bold text-[#F5E3A3] mt-0.5">
                {formatPaise(table.potPaise, false)}
              </div>
              <div className="text-[11px] font-mono-num text-[#98A8A0] mt-1">
                Round #{table.roundNumber} · Blind {formatPaiseCompact(table.currentStakePaise)} · Chaal{' '}
                {formatPaiseCompact(table.currentStakePaise * 2)}
              </div>
              {/* Pot Limit Progress Line */}
              <div className="w-44 h-1 rounded-full bg-[#FAF8F2]/10 mt-2 overflow-hidden">
                <div
                  className="h-full bg-[#D4AF37] transition-all duration-200"
                  style={{ width: `${potProgressPct}%` }}
                />
              </div>
            </div>

            {/* Showdown Result Banner */}
            {table.phase === 'SHOWDOWN' && table.lastWinner && (
              <div className="rounded-xl bg-[#0C1C16]/95 border border-[#10B981]/45 px-5 py-3.5 shadow-[0_16px_40px_rgba(0,0,0,0.6)] space-y-1.5">
                <div className="text-sm font-semibold text-[#FAF8F2]">
                  {table.lastWinner.winnerName} wins{' '}
                  <span className="font-mono-num text-[#10B981]">
                    {formatPaise(table.lastWinner.netPayoutPaise)}
                  </span>
                </div>
                <div className="text-xs text-[#B9C5BE]">
                  {table.lastWinner.winningHandLabel
                    ? table.lastWinner.winningHandLabel
                    : 'All other players packed'}
                  {table.lastWinner.rakePaise > 0
                    ? ` · House rake ${formatPaise(table.lastWinner.rakePaise)}`
                    : ''}
                </div>
                <div className="flex items-center justify-center gap-3 pt-1">
                  {nextRoundSecs !== null && (
                    <span className="text-[11px] font-mono-num text-[#9AA8A1]">
                      Next hand in {nextRoundSecs}s
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={onStartRound}
                    className="px-3 py-1 rounded bg-[#D4AF37] hover:bg-[#E3C152] text-[#09120E] text-xs font-semibold cursor-pointer"
                  >
                    Deal Now
                  </button>
                </div>
              </div>
            )}

            {/* Pending Sideshow Notice */}
            {table.phase === 'SIDESHOW_PENDING' && table.sideshow && !incomingSideshow && (
              <div className="rounded-lg bg-[#12201A]/95 border border-[#D4AF37]/40 px-4 py-2 text-xs text-[#E5C158]">
                {table.sideshow.fromName} requested a Sideshow with {table.sideshow.toName}…
              </div>
            )}

            {/* Incoming Sideshow Decision Prompt for Current Player */}
            {incomingSideshow && table.sideshow && (
              <div className="rounded-xl bg-[#13221B]/96 border border-[#D4AF37] px-5 py-3.5 shadow-[0_16px_38px_rgba(0,0,0,0.65)] space-y-2.5">
                <div className="text-xs font-semibold text-[#FAF8F2]">
                  Sideshow Request from {table.sideshow.fromName}
                </div>
                <p className="text-[11px] text-[#B4C1BA]">
                  Accept to privately compare hands (lower hand packs; ties favor you).
                </p>
                <div className="flex items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => onSideshowResponse(true)}
                    className="px-4 py-1.5 rounded-md bg-[#D4AF37] hover:bg-[#E3C152] text-[#09120E] font-semibold text-xs cursor-pointer"
                  >
                    Accept Sideshow
                  </button>
                  <button
                    type="button"
                    onClick={() => onSideshowResponse(false)}
                    className="px-4 py-1.5 rounded-md bg-[#1C2C25] hover:bg-[#253A31] text-[#FAF8F2] text-xs cursor-pointer"
                  >
                    Decline
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* BOTTOM PLAYER HAND & ERGONOMIC ACTION DOCK */}
      {mySeat && (
        <div className="absolute bottom-0 inset-x-0 z-20 flex flex-col items-center pb-4 px-4 pointer-events-none">
          <div className="pointer-events-auto flex flex-col items-center gap-3 w-full max-w-3xl">
            {/* Player Cards + Hand Rank + Stack Readout */}
            <div className="flex items-end gap-5">
              {/* Seat Status Summary */}
              <div
                className={`px-3.5 py-2 rounded-lg bg-[#0C1813]/92 border ${
                  isMyTurn
                    ? 'border-[#D4AF37] shadow-[0_0_24px_rgba(212,175,55,0.28)]'
                    : 'border-[#FAF8F2]/14'
                }`}
              >
                <div className="flex items-center gap-2 text-xs font-semibold text-[#FAF8F2]">
                  <span>{mySeat.displayName}</span>
                  {table.dealerSeatIndex === mySeatIndex && (
                    <span className="font-mono-num text-[10px] text-[#D4AF37]">(D)</span>
                  )}
                </div>
                <div className="font-mono-num text-sm font-bold text-[#E5C158] mt-0.5">
                  {formatPaise(mySeat.stackPaise, false)}
                </div>
                <div className="text-[11px] text-[#9AA8A1] mt-0.5">
                  {isMyTurn && turnSecondsLeft !== null
                    ? `Your Turn · ${turnSecondsLeft}s`
                    : mySeat.isPacked
                      ? 'Packed'
                      : mySeat.inRound
                        ? mySeat.isSeen
                          ? 'Seen'
                          : 'Playing Blind'
                        : 'Ready for Next Hand'}
                </div>
              </div>

              {/* Player 3-Card Hand */}
              <div className="flex flex-col items-center gap-1.5">
                {mySeat.inRound && (
                  <div className="flex items-center -space-x-3 sm:-space-x-2">
                    {[0, 1, 2].map((ci) => (
                      <div
                        key={ci}
                        style={{
                          transform: `rotate(${(ci - 1) * 5}deg) translateY(${ci === 1 ? -4 : 0}px)`,
                        }}
                      >
                        <PlayingCard
                          card={mySeat.cards ? mySeat.cards[ci] : null}
                          faceUp={mySeat.isSeen && mySeat.cards !== null}
                          size="lg"
                          delayIndex={ci}
                          highlight={
                            table.phase === 'SHOWDOWN' &&
                            table.lastWinner?.winnerSeatIndex === mySeatIndex
                          }
                          dimmed={mySeat.isPacked}
                        />
                      </div>
                    ))}
                  </div>
                )}

                {mySeat.handEvaluation && mySeat.isSeen && (
                  <div className="text-xs font-medium text-[#F5E3A3] bg-[#0B1712]/90 px-3 py-1 rounded border border-[#D4AF37]/30">
                    {mySeat.handEvaluation.label}
                  </div>
                )}
              </div>
            </div>

            {/* Action Dock — Single-Line Plain Human Labels */}
            <div className="flex flex-wrap items-center justify-center gap-2.5 px-4 py-2.5 rounded-xl bg-[#0C1713]/94 border border-[#D4AF37]/25 shadow-[0_12px_32px_rgba(0,0,0,0.55)]">
              {canSee && (
                <button
                  type="button"
                  onClick={() => {
                    soundEngine.playFlip();
                    onAction('see');
                  }}
                  className="px-4 py-2.5 rounded-lg bg-[#1A2D25] hover:bg-[#233D32] border border-[#D4AF37]/40 text-xs font-semibold text-[#F5E3A3] transition-colors cursor-pointer whitespace-nowrap"
                >
                  See Cards <span className="opacity-60 ml-1">[S]</span>
                </button>
              )}

              <button
                type="button"
                disabled={!isMyTurn}
                onClick={() => {
                  soundEngine.playChip();
                  onAction(mySeat.isSeen ? 'chaal' : 'blind');
                }}
                className="px-5 py-2.5 rounded-lg bg-[#D4AF37] hover:bg-[#E4C254] text-[#09120E] font-semibold text-xs transition-colors cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed whitespace-nowrap"
              >
                {mySeat.isSeen ? 'Chaal' : 'Blind'} ·{' '}
                <span className="font-mono-num">{formatPaiseCompact(myCallCost)}</span>
                <span className="opacity-65 ml-1">[C]</span>
              </button>

              <button
                type="button"
                disabled={!canRaise}
                onClick={() => {
                  soundEngine.playRaise();
                  onAction('raise');
                }}
                className="px-4 py-2.5 rounded-lg bg-[#183328] hover:bg-[#1F4536] border border-[#10B981]/40 text-xs font-semibold text-[#A7F3D0] transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed whitespace-nowrap"
              >
                Raise 2x · <span className="font-mono-num">{formatPaiseCompact(myRaiseCost)}</span>
                <span className="opacity-60 ml-1">[R]</span>
              </button>

              {canSideshow && (
                <button
                  type="button"
                  onClick={() => {
                    soundEngine.playChip();
                    onAction('sideshow_request');
                  }}
                  className="px-4 py-2.5 rounded-lg bg-[#1D2A24] hover:bg-[#273830] border border-[#D4AF37]/35 text-xs font-semibold text-[#FAF8F2] transition-colors cursor-pointer whitespace-nowrap"
                >
                  Sideshow <span className="opacity-60 ml-1">[H]</span>
                </button>
              )}

              {canShow && (
                <button
                  type="button"
                  onClick={() => {
                    soundEngine.playRaise();
                    onAction('show');
                  }}
                  className="px-4 py-2.5 rounded-lg bg-[#059669] hover:bg-[#10B981] text-white font-semibold text-xs transition-colors cursor-pointer whitespace-nowrap"
                >
                  Show · <span className="font-mono-num">{formatPaiseCompact(myCallCost)}</span>
                </button>
              )}

              <button
                type="button"
                disabled={!isMyTurn}
                onClick={() => {
                  soundEngine.playPack();
                  onAction('pack');
                }}
                className="px-4 py-2.5 rounded-lg bg-[#2B1215] hover:bg-[#3F191E] border border-[#DC2626]/40 text-xs font-semibold text-[#FCA5A5] transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed whitespace-nowrap"
              >
                Pack <span className="opacity-60 ml-1">[P]</span>
              </button>

              {seatedTotal < 4 && (
                <button
                  type="button"
                  onClick={onFillHouse}
                  className="px-3.5 py-2.5 rounded-lg bg-[#14221C] hover:bg-[#1C3028] border border-[#FAF8F2]/15 text-xs text-[#C7C2B6] transition-colors cursor-pointer whitespace-nowrap"
                  title="Add House challengers to open seats"
                >
                  + House Players
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* COLLAPSIBLE TABLE FEED & CHAT DRAWER */}
      {feedOpen && (
        <aside className="absolute top-16 right-4 bottom-24 z-30 w-80 rounded-xl bg-[#0D1914]/96 border border-[#D4AF37]/25 shadow-[0_20px_50px_rgba(0,0,0,0.65)] flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-[#FAF8F2]/10 flex items-center justify-between">
            <span className="text-xs font-semibold text-[#FAF8F2]">Table Log &amp; Chat</span>
            <button
              type="button"
              onClick={() => setFeedOpen(false)}
              className="text-[#8E9D95] hover:text-[#FAF8F2] cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2 text-xs">
            {table.feed.map((item) => (
              <div key={item.id} className="leading-relaxed">
                <span className="font-mono-num text-[10px] text-[#6E7E76] mr-1.5">
                  {formatShortTime(item.timestamp)}
                </span>
                {item.kind === 'chat' && item.senderName ? (
                  <>
                    <span className="font-semibold text-[#E5C158]">{item.senderName}: </span>
                    <span className="text-[#FAF8F2]">{item.text}</span>
                  </>
                ) : (
                  <span
                    className={
                      item.kind === 'win'
                        ? 'text-[#10B981] font-medium'
                        : item.kind === 'bet'
                          ? 'text-[#DDD8CC]'
                          : 'text-[#94A39B]'
                    }
                  >
                    {item.text}
                  </span>
                )}
              </div>
            ))}
          </div>
          <form
            onSubmit={handleChatSubmit}
            className="p-2.5 border-t border-[#FAF8F2]/10 flex items-center gap-2"
          >
            <input
              type="text"
              value={chatText}
              onChange={(e) => setChatText(e.target.value)}
              placeholder="Send table message..."
              className="flex-1 px-3 py-1.5 rounded-md bg-[#08120E] border border-[#FAF8F2]/12 text-xs text-[#FAF8F2] focus:outline-none focus:border-[#D4AF37]"
            />
            <button
              type="submit"
              className="p-2 rounded-md bg-[#D4AF37] text-[#09120E] hover:bg-[#E3C152] cursor-pointer"
              aria-label="Send message"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </form>
        </aside>
      )}
    </div>
  );
}
