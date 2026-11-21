import { useEffect, useState } from 'react';
import {
  ArrowLeftRight,
  BookOpen,
  CreditCard,
  FileCheck2,
  PlusCircle,
  UserCheck,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { formatPaise } from '../lib/format.ts';
import type { LobbySnapshot, UserProfile } from '../shared/types.ts';
import { BrandMark } from './BrandMark.tsx';

const TITLE_BACKDROP = '/src/assets/images/title_parlor_backdrop_1795231709466.jpg';

export type FinancialTab = 'deposit' | 'transfer' | 'gateways' | 'audit';

interface TitleScreenProps {
  user: UserProfile | null;
  lobby: LobbySnapshot | null;
  wsConnected: boolean;
  muted: boolean;
  onToggleMute: () => void;
  onEnterLobby: () => void;
  onOpenFinance: (tab: FinancialTab) => void;
  onOpenAuth: () => void;
  onOpenRules: () => void;
}

export function TitleScreen({
  user,
  lobby,
  wsConnected,
  muted,
  onToggleMute,
  onEnterLobby,
  onOpenFinance,
  onOpenAuth,
  onOpenRules,
}: TitleScreenProps) {
  const [backdropError, setBackdropError] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
        return;
      }
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onEnterLobby();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onEnterLobby]);

  const activeTables = lobby?.tables.length ?? 3;
  const onlinePlayers = lobby?.onlineCount ?? 1;

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#08120E] flex flex-col justify-between select-none">
      {/* Atmospheric Parlor Key-Art Backdrop */}
      {!backdropError ? (
        <img
          src={TITLE_BACKDROP}
          alt="Luxury emerald green 3 Patti card table under warm parlor lamp"
          referrerPolicy="no-referrer"
          onError={() => setBackdropError(true)}
          className="absolute inset-0 w-full h-full object-cover object-center"
        />
      ) : (
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_70%_55%,#14523A_0%,#0B261C_52%,#060E0B_100%)]" />
      )}

      {/* Measured contrast scrim protecting the left 45% negative space & bottom hint */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'linear-gradient(96deg, rgba(6,13,10,0.94) 0%, rgba(7,16,12,0.84) 40%, rgba(7,16,12,0.34) 68%, rgba(6,13,10,0.52) 100%), linear-gradient(180deg, rgba(6,13,10,0.52) 0%, rgba(6,13,10,0.08) 28%, rgba(6,13,10,0.12) 72%, rgba(6,13,10,0.88) 100%)',
        }}
      />

      {/* Minimal Top Perimeter HUD */}
      <div className="relative z-10 flex items-center justify-between px-6 sm:px-10 pt-6">
        <div className="flex items-center gap-3 text-xs text-[#C7C2B6]">
          <span className="inline-flex items-center gap-1.5">
            <span
              className={`w-1.5 h-1.5 rounded-full ${wsConnected ? 'bg-[#10B981]' : 'bg-[#D4AF37]'}`}
              aria-hidden="true"
            />
            {wsConnected ? 'Live Server' : 'Connecting'}
          </span>
          <span aria-hidden="true">·</span>
          <span className="font-mono-num">{onlinePlayers} Online</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono-num">{activeTables} Tables Open</span>
        </div>

        <div className="flex items-center gap-4">
          {user && (
            <button
              type="button"
              onClick={onOpenAuth}
              className="flex items-center gap-3 px-3.5 py-2 rounded-lg bg-[#111D18]/85 border border-[#D4AF37]/25 hover:border-[#D4AF37]/55 transition-colors text-left cursor-pointer whitespace-nowrap shrink-0"
            >
              <UserCheck className="w-4 h-4 text-[#D4AF37] shrink-0" />
              <span className="text-xs font-medium text-[#FAF8F2]">{user.displayName}</span>
              <span className="text-xs text-[#8E9B94]" aria-hidden="true">·</span>
              <span className="font-mono-num text-xs font-semibold text-[#E5C158]">
                {formatPaise(user.balancePaise)}
              </span>
            </button>
          )}

          <button
            type="button"
            onClick={onOpenRules}
            className="p-2.5 rounded-lg bg-[#111D18]/80 border border-[#FAF8F2]/12 text-[#D9D5CA] hover:text-[#FAF8F2] hover:border-[#D4AF37]/40 transition-colors cursor-pointer"
            aria-label="Game Rules"
            title="3 Patti Rules & Shortcuts"
          >
            <BookOpen className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={onToggleMute}
            className="p-2.5 rounded-lg bg-[#111D18]/80 border border-[#FAF8F2]/12 text-[#D9D5CA] hover:text-[#FAF8F2] hover:border-[#D4AF37]/40 transition-colors cursor-pointer"
            aria-label={muted ? 'Unmute audio' : 'Mute audio'}
            title={muted ? 'Unmute audio' : 'Mute audio'}
          >
            {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Main Left-Aligned Hero Composition over 40% Calm Negative Space */}
      <div className="relative z-10 flex-1 flex items-center px-6 sm:px-10 lg:px-16">
        <div className="max-w-lg w-full space-y-7">
          <BrandMark variant="hero" />

          <p className="text-[15px] leading-relaxed text-[#D2CEC3] max-w-md">
            High-stakes multiplayer 3 Patti tables with real-time matchmaking, escrowed cash buy-ins,
            configurable payment gateways, instant player-to-player transfers, and SHA-256 verified
            audit logs.
          </p>

          {/* Primary Start CTA */}
          <div className="flex flex-wrap items-center gap-4 pt-1">
            <button
              type="button"
              onClick={onEnterLobby}
              className="px-7 py-3.5 rounded-lg bg-[#D4AF37] hover:bg-[#E2BF4E] active:scale-[0.99] text-[#0A130F] font-semibold text-sm tracking-wide transition-all cursor-pointer shadow-[0_12px_28px_rgba(212,175,55,0.22)] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F5E3A3]"
            >
              Play 3 Patti · Enter Matchmaking
            </button>

            <button
              type="button"
              onClick={() => onOpenFinance('deposit')}
              className="px-5 py-3.5 rounded-lg bg-[#12201A]/90 hover:bg-[#1A2D25] border border-[#D4AF37]/35 text-[#FAF8F2] font-medium text-sm transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              Deposit Money
            </button>
          </div>

          {/* Direct Cashier & Operations Strip */}
          <div className="pt-4 border-t border-[#FAF8F2]/10">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2.5 text-xs font-medium text-[#C8C3B8]">
              <button
                type="button"
                onClick={() => onOpenFinance('deposit')}
                className="inline-flex items-center gap-1.5 hover:text-[#E5C158] transition-colors cursor-pointer whitespace-nowrap"
              >
                <PlusCircle className="w-3.5 h-3.5 text-[#D4AF37]" />
                Money Deposit
              </button>
              <button
                type="button"
                onClick={() => onOpenFinance('transfer')}
                className="inline-flex items-center gap-1.5 hover:text-[#E5C158] transition-colors cursor-pointer whitespace-nowrap"
              >
                <ArrowLeftRight className="w-3.5 h-3.5 text-[#D4AF37]" />
                Money Transfers
              </button>
              <button
                type="button"
                onClick={() => onOpenFinance('gateways')}
                className="inline-flex items-center gap-1.5 hover:text-[#E5C158] transition-colors cursor-pointer whitespace-nowrap"
              >
                <CreditCard className="w-3.5 h-3.5 text-[#D4AF37]" />
                Payment Gateways
              </button>
              <button
                type="button"
                onClick={() => onOpenFinance('audit')}
                className="inline-flex items-center gap-1.5 hover:text-[#E5C158] transition-colors cursor-pointer whitespace-nowrap"
              >
                <FileCheck2 className="w-3.5 h-3.5 text-[#D4AF37]" />
                Audit Logs
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Single Flat Control-Hint Line */}
      <div className="relative z-10 px-6 sm:px-10 pb-5 flex flex-wrap items-center justify-between gap-4 text-xs text-[#9AA69F]">
        <p className="tracking-wide">
          Enter / Space Matchmaking · S See Cards · C Blind / Chaal · R Raise 2x · H Sideshow · P Pack · Esc Menu
        </p>
        <p className="font-mono-num text-[#85928B]">
          Open a second tab &amp; switch player to play live PvP or test P2P transfers
        </p>
      </div>
    </div>
  );
}
