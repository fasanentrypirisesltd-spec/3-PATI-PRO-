import { useState } from 'react';
import { rankToLabel } from '../shared/teenPatti.ts';
import type { Card, Suit } from '../shared/types.ts';

const CARD_BACK_IMAGE = '/src/assets/images/card_back_royal_1795231712299.jpg';

const SUIT_META: Record<Suit, { symbol: string; isRed: boolean; label: string }> = {
  spades: { symbol: '♠', isRed: false, label: 'Spades' },
  hearts: { symbol: '♥', isRed: true, label: 'Hearts' },
  diamonds: { symbol: '♦', isRed: true, label: 'Diamonds' },
  clubs: { symbol: '♣', isRed: false, label: 'Clubs' },
};

interface PlayingCardProps {
  card: Card | null;
  faceUp: boolean;
  size?: 'sm' | 'md' | 'lg';
  delayIndex?: number;
  highlight?: boolean;
  dimmed?: boolean;
}

export function PlayingCard({
  card,
  faceUp,
  size = 'md',
  delayIndex = 0,
  highlight = false,
  dimmed = false,
}: PlayingCardProps) {
  const [imgFailed, setImgFailed] = useState(false);

  const dims =
    size === 'sm'
      ? 'w-[46px] h-[64px] rounded-[6px]'
      : size === 'lg'
        ? 'w-[84px] h-[118px] sm:w-[96px] sm:h-[134px] rounded-[10px]'
        : 'w-[62px] h-[88px] rounded-[8px]';

  const cornerText =
    size === 'sm' ? 'text-[11px] leading-none' : size === 'lg' ? 'text-[17px] leading-none' : 'text-[13px] leading-none';

  const centerSymbol =
    size === 'sm' ? 'text-[22px]' : size === 'lg' ? 'text-[42px]' : 'text-[28px]';

  const suitInfo = card ? SUIT_META[card.suit] : null;
  const rankText = card ? rankToLabel(card.rank) : '';
  const showFront = faceUp && card !== null;

  return (
    <div
      className={`card-perspective animate-deal select-none shrink-0 ${dims} ${dimmed ? 'opacity-45' : ''}`}
      style={{ animationDelay: `${delayIndex * 55}ms` }}
    >
      <div
        className={`card-inner ${showFront ? 'is-flipped' : ''} ${
          highlight ? 'ring-2 ring-[#D4AF37] shadow-[0_0_24px_rgba(212,175,55,0.35)]' : ''
        } rounded-[inherit]`}
      >
        {/* Back face */}
        <div className="card-face overflow-hidden rounded-[inherit] border border-[#E5D7B8]/70 bg-[#3B0D18] shadow-[0_8px_18px_rgba(0,0,0,0.45)]">
          {!imgFailed ? (
            <img
              src={CARD_BACK_IMAGE}
              alt="Royal Patti card back"
              referrerPolicy="no-referrer"
              onError={() => setImgFailed(true)}
              className="w-full h-full object-cover scale-[1.12]"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-[#4E1020] via-[#340914] to-[#23050C] p-1.5">
              <div className="w-full h-full border border-[#D4AF37]/60 rounded-[4px] flex items-center justify-center">
                <span className="text-[#D4AF37] text-lg">❖</span>
              </div>
            </div>
          )}
        </div>

        {/* Front face */}
        <div
          className="card-face card-face-front rounded-[inherit] border border-[#D8CEB8] bg-[#FAF8F2] shadow-[0_10px_22px_rgba(0,0,0,0.42)] flex flex-col justify-between p-1.5 sm:p-2"
          aria-label={card && suitInfo ? `${rankText} of ${suitInfo.label}` : 'Hidden card'}
        >
          {card && suitInfo && (
            <>
              <div
                className={`flex flex-col items-start font-bold ${cornerText} ${
                  suitInfo.isRed ? 'text-[#C81E1E]' : 'text-[#141A18]'
                }`}
              >
                <span className="font-mono-num tracking-tighter">{rankText}</span>
                <span className="mt-0.5">{suitInfo.symbol}</span>
              </div>

              <div
                className={`self-center leading-none ${centerSymbol} ${
                  suitInfo.isRed ? 'text-[#C81E1E]' : 'text-[#141A18]'
                }`}
              >
                {suitInfo.symbol}
              </div>

              <div
                className={`flex flex-col items-start font-bold rotate-180 ${cornerText} ${
                  suitInfo.isRed ? 'text-[#C81E1E]' : 'text-[#141A18]'
                }`}
              >
                <span className="font-mono-num tracking-tighter">{rankText}</span>
                <span className="mt-0.5">{suitInfo.symbol}</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
