import type { Card, HandEvaluation, Rank, Suit } from './types.ts';

const SUITS: Suit[] = ['spades', 'hearts', 'diamonds', 'clubs'];
const RANKS: Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

export function rankToLabel(rank: Rank): string {
  if (rank === 14) return 'A';
  if (rank === 13) return 'K';
  if (rank === 12) return 'Q';
  if (rank === 11) return 'J';
  return String(rank);
}

export function rankToWord(rank: Rank): string {
  const words: Record<Rank, string> = {
    2: 'Twos',
    3: 'Threes',
    4: 'Fours',
    5: 'Fives',
    6: 'Sixes',
    7: 'Sevens',
    8: 'Eights',
    9: 'Nines',
    10: 'Tens',
    11: 'Jacks',
    12: 'Queens',
    13: 'Kings',
    14: 'Aces',
  };
  return words[rank];
}

export function rankToSingular(rank: Rank): string {
  const words: Record<Rank, string> = {
    2: '2',
    3: '3',
    4: '4',
    5: '5',
    6: '6',
    7: '7',
    8: '8',
    9: '9',
    10: '10',
    11: 'Jack',
    12: 'Queen',
    13: 'King',
    14: 'Ace',
  };
  return words[rank];
}

export function createShuffledDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank });
    }
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = deck[i];
    deck[i] = deck[j];
    deck[j] = tmp;
  }
  return deck;
}

/**
 * Authentic Teen Patti (3 Patti) hand evaluator.
 * Order (highest to lowest):
 * 6: Trail / Trio (AAA > KKK > ... > 222)
 * 5: Pure Sequence / Straight Flush (AKQ > A23 > KQJ > ... > 432)
 * 4: Sequence / Straight (AKQ > A23 > KQJ > ... > 432)
 * 3: Color / Flush (high card, 2nd, 3rd)
 * 2: Pair (pair rank, kicker)
 * 1: High Card (high card, 2nd, 3rd)
 */
export function evaluateTeenPattiHand(cards: Card[]): HandEvaluation {
  const sorted = [...cards].sort((a, b) => b.rank - a.rank);
  const [r1, r2, r3] = sorted.map((c) => c.rank);
  const isFlush = sorted[0].suit === sorted[1].suit && sorted[1].suit === sorted[2].suit;

  // 1. Trail (Three of a Kind)
  if (r1 === r2 && r2 === r3) {
    return {
      category: 'TRAIL',
      categoryRank: 6,
      tiebreakers: [r1],
      label: `Trail of ${rankToWord(r1)}`,
    };
  }

  // Sequence detection: AKQ = 15 (highest), A-2-3 = 14 (2nd highest), KQJ = 13 ... 4-3-2 = 4
  let isSeq = false;
  let seqStrength = 0;
  let seqText = '';

  if (r1 === 14 && r2 === 13 && r3 === 12) {
    isSeq = true;
    seqStrength = 15;
    seqText = 'A-K-Q';
  } else if (r1 === 14 && r2 === 3 && r3 === 2) {
    isSeq = true;
    seqStrength = 14;
    seqText = 'A-2-3';
  } else if (r1 === r2 + 1 && r2 === r3 + 1) {
    isSeq = true;
    seqStrength = r1;
    seqText = `${rankToLabel(r1)}-${rankToLabel(r2)}-${rankToLabel(r3)}`;
  }

  // 2. Pure Sequence (Straight Flush)
  if (isSeq && isFlush) {
    return {
      category: 'PURE_SEQUENCE',
      categoryRank: 5,
      tiebreakers: [seqStrength],
      label: `Pure Sequence · ${seqText}`,
    };
  }

  // 3. Sequence (Straight)
  if (isSeq) {
    return {
      category: 'SEQUENCE',
      categoryRank: 4,
      tiebreakers: [seqStrength],
      label: `Sequence · ${seqText}`,
    };
  }

  // 4. Color (Flush)
  if (isFlush) {
    return {
      category: 'COLOR',
      categoryRank: 3,
      tiebreakers: [r1, r2, r3],
      label: `Color · ${rankToSingular(r1)} High`,
    };
  }

  // 5. Pair
  if (r1 === r2 || r2 === r3) {
    const pairRank = r1 === r2 ? r1 : r2;
    const kicker = r1 === r2 ? r3 : r1;
    return {
      category: 'PAIR',
      categoryRank: 2,
      tiebreakers: [pairRank, kicker],
      label: `Pair of ${rankToWord(pairRank)}`,
    };
  }

  // 6. High Card
  return {
    category: 'HIGH_CARD',
    categoryRank: 1,
    tiebreakers: [r1, r2, r3],
    label: `High Card · ${rankToSingular(r1)}`,
  };
}

/**
 * Returns > 0 if hand A beats hand B, < 0 if hand B beats hand A, 0 if exact tie.
 */
export function compareTeenPattiHands(a: HandEvaluation, b: HandEvaluation): number {
  if (a.categoryRank !== b.categoryRank) {
    return a.categoryRank - b.categoryRank;
  }
  const len = Math.max(a.tiebreakers.length, b.tiebreakers.length);
  for (let i = 0; i < len; i++) {
    const av = a.tiebreakers[i] ?? 0;
    const bv = b.tiebreakers[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}
