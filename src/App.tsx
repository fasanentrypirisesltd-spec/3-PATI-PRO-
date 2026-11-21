import { useCallback, useEffect, useState } from 'react';
import { AuthModal } from './components/AuthModal.tsx';
import { FinancialModal } from './components/FinancialModal.tsx';
import { GameTable } from './components/GameTable.tsx';
import { MatchmakingLobby } from './components/MatchmakingLobby.tsx';
import { RulesModal } from './components/RulesModal.tsx';
import { TitleScreen, type FinancialTab } from './components/TitleScreen.tsx';
import { api, getStoredToken, realtimeSocket, setStoredToken } from './lib/api.ts';
import { formatPaise } from './lib/format.ts';
import { soundEngine } from './lib/sound.ts';
import type { LobbySnapshot, StakesTierId, TableSnapshot, UserProfile } from './shared/types.ts';

type ScreenState = 'TITLE' | 'LOBBY' | 'TABLE';

interface ToastNotice {
  id: number;
  text: string;
  tone: 'info' | 'success' | 'error';
}

export default function App() {
  const [screen, setScreen] = useState<ScreenState>('TITLE');
  const [user, setUser] = useState<UserProfile | null>(null);
  const [lobby, setLobby] = useState<LobbySnapshot | null>(null);
  const [activeTable, setActiveTable] = useState<TableSnapshot | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [muted, setMuted] = useState(() => soundEngine.isMuted());

  const [financeOpen, setFinanceOpen] = useState(false);
  const [financeTab, setFinanceTab] = useState<FinancialTab>('deposit');
  const [authOpen, setAuthOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastNotice[]>([]);

  const pushToast = useCallback((text: string, tone: ToastNotice['tone'] = 'info') => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((prev) => [...prev.slice(-3), { id, text, tone }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4200);
  }, []);

  const connectWithSession = useCallback((profile: UserProfile, token: string) => {
    setStoredToken(token);
    setUser(profile);
    realtimeSocket.connect(token);
  }, []);

  // Hydrate existing session or auto-connect default club player for zero-friction start
  useEffect(() => {
    let cancelled = false;
    async function initSession() {
      const existingToken = getStoredToken();
      if (existingToken) {
        try {
          const { user: me } = await api.me();
          if (!cancelled) {
            connectWithSession(me, existingToken);
          }
          return;
        } catch {
          setStoredToken(null);
        }
      }
      try {
        const res = await api.quickSwitch('arjun');
        if (!cancelled) {
          connectWithSession(res.user, res.token);
        }
      } catch {
        if (!cancelled) {
          setAuthOpen(true);
        }
      }
    }
    initSession();
    return () => {
      cancelled = true;
      realtimeSocket.disconnect();
    };
  }, [connectWithSession]);

  // Subscribe to WebSocket server-authoritative events
  useEffect(() => {
    const unsubStatus = realtimeSocket.onStatus((connected) => {
      setWsConnected(connected);
    });

    const unsubMsg = realtimeSocket.onMessage((msg) => {
      switch (msg.type) {
        case 'connected':
          setUser(msg.user);
          setLobby(msg.lobby);
          break;
        case 'lobby:update':
          setLobby(msg.lobby);
          break;
        case 'table:state':
          setActiveTable(msg.table);
          setScreen('TABLE');
          break;
        case 'table:left':
          setActiveTable(null);
          setScreen('LOBBY');
          setUser((prev) =>
            prev
              ? { ...prev, balancePaise: msg.newBalancePaise, escrowedPaise: 0 }
              : prev
          );
          pushToast(`Cashed out ${formatPaise(msg.cashOutPaise)} to wallet`, 'success');
          break;
        case 'wallet:update':
          setUser((prev) =>
            prev
              ? {
                  ...prev,
                  balancePaise: msg.balancePaise,
                  escrowedPaise: msg.escrowedPaise,
                }
              : prev
          );
          if (msg.notice) {
            soundEngine.playCashSettled();
            pushToast(msg.notice, 'success');
          }
          break;
        case 'error':
          pushToast(msg.message, 'error');
          break;
      }
    });

    return () => {
      unsubStatus();
      unsubMsg();
    };
  }, [pushToast]);

  const handleOpenFinance = useCallback((tab: FinancialTab) => {
    setFinanceTab(tab);
    setFinanceOpen(true);
  }, []);

  const handleToggleMute = useCallback(() => {
    const next = soundEngine.toggleMute();
    setMuted(next);
  }, []);

  const handleAuthenticated = useCallback(
    (newUser: UserProfile, token: string) => {
      setActiveTable(null);
      if (screen === 'TABLE') setScreen('LOBBY');
      connectWithSession(newUser, token);
      pushToast(`Signed in as ${newUser.displayName}`, 'info');
    },
    [connectWithSession, pushToast, screen]
  );

  const handleQuickMatch = useCallback((tierId: StakesTierId, buyInPaise: number) => {
    soundEngine.playChip();
    realtimeSocket.send({ type: 'queue:join', tierId, buyInPaise });
  }, []);

  const handleJoinTable = useCallback(
    (tableId: string, buyInPaise: number, inviteCode?: string) => {
      soundEngine.playChip();
      realtimeSocket.send({ type: 'table:join', tableId, buyInPaise, inviteCode });
    },
    []
  );

  const handleGameAction = useCallback(
    (action: 'see' | 'blind' | 'chaal' | 'raise' | 'pack' | 'show' | 'sideshow_request') => {
      realtimeSocket.send({ type: 'game:action', action });
    },
    []
  );

  return (
    <div className="min-h-screen w-full bg-[#09120E] text-[#F2EFE9]">
      {screen === 'TITLE' && (
        <TitleScreen
          user={user}
          lobby={lobby}
          wsConnected={wsConnected}
          muted={muted}
          onToggleMute={handleToggleMute}
          onEnterLobby={() => {
            if (activeTable) {
              setScreen('TABLE');
            } else {
              setScreen('LOBBY');
            }
          }}
          onOpenFinance={handleOpenFinance}
          onOpenAuth={() => setAuthOpen(true)}
          onOpenRules={() => setRulesOpen(true)}
        />
      )}

      {screen === 'LOBBY' && user && (
        <MatchmakingLobby
          user={user}
          lobby={lobby}
          onBackToTitle={() => setScreen('TITLE')}
          onQuickMatch={handleQuickMatch}
          onJoinTable={handleJoinTable}
          onOpenFinance={handleOpenFinance}
          onOpenAuth={() => setAuthOpen(true)}
        />
      )}

      {screen === 'TABLE' && user && activeTable && (
        <GameTable
          user={user}
          table={activeTable}
          muted={muted}
          onToggleMute={handleToggleMute}
          onAction={handleGameAction}
          onSideshowResponse={(accept) =>
            realtimeSocket.send({ type: 'game:sideshow_response', accept })
          }
          onFillHouse={() => realtimeSocket.send({ type: 'table:fill_house' })}
          onStartRound={() => realtimeSocket.send({ type: 'table:start_round' })}
          onTopUp={(amountPaise) => realtimeSocket.send({ type: 'table:topup', amountPaise })}
          onLeaveTable={() => realtimeSocket.send({ type: 'table:leave' })}
          onSendChat={(text) => realtimeSocket.send({ type: 'table:chat', text })}
          onOpenFinance={handleOpenFinance}
          onOpenRules={() => setRulesOpen(true)}
        />
      )}

      {/* Financial Operations Console (Deposits, Money Transfers, Gateways, Audit Logs) */}
      {user && (
        <FinancialModal
          open={financeOpen}
          initialTab={financeTab}
          user={user}
          onClose={() => setFinanceOpen(false)}
          onUserUpdated={setUser}
        />
      )}

      {/* Account Switcher / Sign In / Register */}
      <AuthModal
        open={authOpen}
        currentUser={user}
        onClose={() => setAuthOpen(false)}
        onAuthenticated={handleAuthenticated}
      />

      {/* 3 Patti Rules & Hand Hierarchy */}
      <RulesModal open={rulesOpen} onClose={() => setRulesOpen(false)} />

      {/* Live Toast Notifications */}
      {toasts.length > 0 && (
        <div className="fixed bottom-4 left-4 z-50 flex flex-col gap-2 max-w-sm pointer-events-none">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={`px-4 py-2.5 rounded-lg border text-xs font-medium shadow-[0_12px_28px_rgba(0,0,0,0.55)] ${
                t.tone === 'error'
                  ? 'bg-[#2B1215]/95 border-[#DC2626]/50 text-[#FCA5A5]'
                  : t.tone === 'success'
                    ? 'bg-[#0E241B]/95 border-[#10B981]/45 text-[#A7F3D0]'
                    : 'bg-[#101D17]/95 border-[#D4AF37]/35 text-[#F5E3A3]'
              }`}
            >
              {t.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
