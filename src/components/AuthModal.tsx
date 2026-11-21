import { useState } from 'react';
import { X } from 'lucide-react';
import { api } from '../lib/api.ts';
import type { UserProfile } from '../shared/types.ts';

interface AuthModalProps {
  open: boolean;
  currentUser: UserProfile | null;
  onClose: () => void;
  onAuthenticated: (user: UserProfile, token: string) => void;
}

const DEMO_ACCOUNTS = [
  { username: 'arjun', name: 'Arjun Mehta', role: 'Admin & VIP Player' },
  { username: 'priya', name: 'Priya Kapoor', role: 'Club Player' },
  { username: 'kabir', name: 'Kabir Verma', role: 'Club Player' },
  { username: 'meera', name: 'Meera Nair', role: 'Club Player' },
];

export function AuthModal({ open, currentUser, onClose, onAuthenticated }: AuthModalProps) {
  const [mode, setMode] = useState<'switch' | 'login' | 'register'>('switch');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleQuickSwitch = async (targetUsername: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.quickSwitch(targetUsername);
      onAuthenticated(res.user, res.token);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to switch account.');
    } finally {
      setBusy(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.login(username, password);
      onAuthenticated(res.user, res.token);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.register({ username, displayName, email, password });
      onAuthenticated(res.user, res.token);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Player Account"
    >
      <div className="w-full max-w-md rounded-xl bg-[#0D1914] border border-[#D4AF37]/28 shadow-[0_24px_60px_rgba(0,0,0,0.75)] overflow-hidden">
        <div className="px-5 py-4 border-b border-[#FAF8F2]/10 flex items-center justify-between">
          <div>
            <h2 className="font-display text-lg font-semibold text-[#FAF8F2]">Player Account</h2>
            {currentUser && (
              <p className="text-xs text-[#94A39B]">
                Signed in as {currentUser.displayName} (@{currentUser.username})
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#94A39B] hover:text-[#FAF8F2] cursor-pointer"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 pt-3 flex gap-1 border-b border-[#FAF8F2]/10 text-xs">
          {(
            [
              ['switch', 'Switch Player'],
              ['login', 'Sign In'],
              ['register', 'New Account'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setMode(id);
                setError(null);
              }}
              className={`px-3 py-2 border-b-2 font-medium transition-colors cursor-pointer ${
                mode === id
                  ? 'border-[#D4AF37] text-[#F5E3A3]'
                  : 'border-transparent text-[#8F9E96] hover:text-[#FAF8F2]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="p-5">
          {mode === 'switch' && (
            <div className="space-y-3">
              <p className="text-xs text-[#9AA8A1] leading-relaxed">
                Switch between funded club accounts or open a second browser tab with a different
                player to test live multiplayer matchmaking and instant P2P money transfers.
              </p>
              <div className="space-y-2">
                {DEMO_ACCOUNTS.map((acc) => {
                  const isCurrent = currentUser?.username === acc.username;
                  return (
                    <button
                      key={acc.username}
                      type="button"
                      disabled={busy || isCurrent}
                      onClick={() => handleQuickSwitch(acc.username)}
                      className={`w-full px-3.5 py-2.5 rounded-lg border flex items-center justify-between text-left transition-colors cursor-pointer disabled:cursor-default ${
                        isCurrent
                          ? 'bg-[#162921] border-[#D4AF37]'
                          : 'bg-[#0A1410] border-[#FAF8F2]/12 hover:border-[#D4AF37]/45'
                      }`}
                    >
                      <div>
                        <div className="text-xs font-semibold text-[#FAF8F2]">{acc.name}</div>
                        <div className="text-[11px] text-[#8E9D95]">
                          @{acc.username} · {acc.role}
                        </div>
                      </div>
                      <span className="text-xs font-medium text-[#E5C158]">
                        {isCurrent ? 'Active' : 'Switch'}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-[#7A8A82]">
                Password for seeded accounts in Sign In mode: <span className="font-mono-num">patti123</span>
              </p>
            </div>
          )}

          {mode === 'login' && (
            <form onSubmit={handleLogin} className="space-y-3.5">
              <div>
                <label className="block text-xs text-[#A5B3AB] mb-1">Username or Email</label>
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[#0A1410] border border-[#FAF8F2]/15 text-sm text-[#FAF8F2]"
                />
              </div>
              <div>
                <label className="block text-xs text-[#A5B3AB] mb-1">Password</label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[#0A1410] border border-[#FAF8F2]/15 text-sm text-[#FAF8F2]"
                />
              </div>
              <button
                type="submit"
                disabled={busy}
                className="w-full py-2.5 rounded-lg bg-[#D4AF37] hover:bg-[#E3C152] text-[#09120E] font-semibold text-xs cursor-pointer disabled:opacity-50"
              >
                {busy ? 'Signing In...' : 'Sign In'}
              </button>
            </form>
          )}

          {mode === 'register' && (
            <form onSubmit={handleRegister} className="space-y-3">
              <div>
                <label className="block text-xs text-[#A5B3AB] mb-1">Display Name</label>
                <input
                  type="text"
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Riya Sen"
                  className="w-full px-3 py-2 rounded-lg bg-[#0A1410] border border-[#FAF8F2]/15 text-sm text-[#FAF8F2]"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-[#A5B3AB] mb-1">Username</label>
                  <input
                    type="text"
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="riyasen"
                    className="w-full px-3 py-2 rounded-lg bg-[#0A1410] border border-[#FAF8F2]/15 text-sm text-[#FAF8F2]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#A5B3AB] mb-1">Email</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="riya@club.in"
                    className="w-full px-3 py-2 rounded-lg bg-[#0A1410] border border-[#FAF8F2]/15 text-sm text-[#FAF8F2]"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs text-[#A5B3AB] mb-1">Password (min 6 chars)</label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[#0A1410] border border-[#FAF8F2]/15 text-sm text-[#FAF8F2]"
                />
              </div>
              <button
                type="submit"
                disabled={busy}
                className="w-full py-2.5 rounded-lg bg-[#D4AF37] hover:bg-[#E3C152] text-[#09120E] font-semibold text-xs cursor-pointer disabled:opacity-50"
              >
                {busy ? 'Creating Account...' : 'Create Account (₹5,000 Starter Bankroll)'}
              </button>
            </form>
          )}

          {error && <p className="text-xs text-[#F87171] mt-3">{error}</p>}
        </div>
      </div>
    </div>
  );
}
