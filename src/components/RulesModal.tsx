import { X } from 'lucide-react';
import type { Card } from '../shared/types.ts';
import { PlayingCard } from './PlayingCard.tsx';

interface RulesModalProps {
  open: boolean;
  onClose: () => void;
}

const HAND_RANKS: Array<{ title: string; desc: string; cards: Card[] }> = [
  {
    title: '1. Trail (Three of a Kind)',
    desc: 'Three cards of identical rank. A-A-A is highest; 2-2-2 is lowest.',
    cards: [
      { suit: 'spades', rank: 14 },
      { suit: 'hearts', rank: 14 },
      { suit: 'diamonds', rank: 14 },
    ],
  },
  {
    title: '2. Pure Sequence (Straight Flush)',
    desc: 'Three consecutive cards of the same suit. A-K-Q highest, A-2-3 second.',
    cards: [
      { suit: 'hearts', rank: 14 },
      { suit: 'hearts', rank: 13 },
      { suit: 'hearts', rank: 12 },
    ],
  },
  {
    title: '3. Sequence (Straight)',
    desc: 'Three consecutive cards in mixed suits. A-K-Q > A-2-3 > K-Q-J.',
    cards: [
      { suit: 'clubs', rank: 14 },
      { suit: 'spades', rank: 3 },
      { suit: 'diamonds', rank: 2 },
    ],
  },
  {
    title: '4. Color (Flush)',
    desc: 'Three cards of the same suit, not in sequence. Highest card wins.',
    cards: [
      { suit: 'spades', rank: 13 },
      { suit: 'spades', rank: 9 },
      { suit: 'spades', rank: 5 },
    ],
  },
  {
    title: '5. Pair',
    desc: 'Two cards of equal rank plus one kicker.',
    cards: [
      { suit: 'diamonds', rank: 11 },
      { suit: 'clubs', rank: 11 },
      { suit: 'spades', rank: 8 },
    ],
  },
  {
    title: '6. High Card',
    desc: 'Unmatched hand ranked by highest card, then second and third.',
    cards: [
      { suit: 'spades', rank: 14 },
      { suit: 'diamonds', rank: 10 },
      { suit: 'clubs', rank: 4 },
    ],
  },
];

export function RulesModal({ open, onClose }: RulesModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="3 Patti Rules and Hand Rankings"
    >
      <div className="w-full max-w-2xl max-h-[88vh] rounded-xl bg-[#0D1914] border border-[#D4AF37]/28 shadow-[0_24px_60px_rgba(0,0,0,0.75)] flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-[#FAF8F2]/10 flex items-center justify-between">
          <div>
            <h2 className="font-display text-xl font-semibold text-[#FAF8F2]">
              3 Patti Rules &amp; Hand Hierarchy
            </h2>
            <p className="text-xs text-[#94A39B] mt-0.5">
              Authentic Teen Patti betting rules, Blind vs. Seen stakes, and Sideshow mechanics.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#94A39B] hover:text-[#FAF8F2] cursor-pointer"
            aria-label="Close Rules"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {HAND_RANKS.map((h) => (
              <div
                key={h.title}
                className="rounded-lg bg-[#0A1410] border border-[#FAF8F2]/10 p-3.5 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-[#F5E3A3]">{h.title}</div>
                  <p className="text-[11px] text-[#9AA8A1] mt-1 leading-relaxed">{h.desc}</p>
                </div>
                <div className="flex -space-x-4 shrink-0">
                  {h.cards.map((c, idx) => (
                    <PlayingCard key={idx} card={c} faceUp size="sm" />
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-lg bg-[#0A1410] border border-[#FAF8F2]/10 p-4 space-y-2 text-xs text-[#B8C4BD] leading-relaxed">
            <div className="font-semibold text-[#FAF8F2]">Betting &amp; Cash Escrow Rules</div>
            <p>
              <strong className="text-[#E5C158]">Blind vs. Seen:</strong> Everyone starts Blind.
              Blind players bet 1x the current unit stake; clicking <em>See Cards</em> reveals your
              3 cards and requires 2x the unit stake (Chaal) to stay in.
            </p>
            <p>
              <strong className="text-[#E5C158]">Sideshow:</strong> With 3+ active players, a Seen
              player may challenge the previous Seen player. If accepted, the weaker hand packs
              automatically (ties favor the challenged player).
            </p>
            <p>
              <strong className="text-[#E5C158]">Show &amp; Pot Limit:</strong> When 2 players
              remain, call Show to reveal both hands. Reaching the Pot Limit triggers an automatic
              showdown. All buy-ins, top-ups, pot wins, and cash-outs are escrowed atomically and
              recorded in the SHA-256 Audit Log.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
