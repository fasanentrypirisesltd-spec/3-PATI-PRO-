export type Suit = 'spades' | 'hearts' | 'diamonds' | 'clubs';
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14; // 11=J, 12=Q, 13=K, 14=A

export interface Card {
  suit: Suit;
  rank: Rank;
}

export type HandCategory =
  | 'TRAIL'
  | 'PURE_SEQUENCE'
  | 'SEQUENCE'
  | 'COLOR'
  | 'PAIR'
  | 'HIGH_CARD';

export interface HandEvaluation {
  category: HandCategory;
  categoryRank: number; // 6 highest (TRAIL) down to 1 (HIGH_CARD)
  tiebreakers: number[];
  label: string;
}

export type UserRole = 'player' | 'admin';

export interface UserProfile {
  id: string;
  username: string;
  displayName: string;
  email: string;
  role: UserRole;
  balancePaise: number;
  escrowedPaise: number;
  createdAt: string;
}

export interface DirectoryUser {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
}

export type GatewayProviderType = 'UPI' | 'CARD' | 'BANK_TRANSFER' | 'WALLET' | 'CRYPTO';
export type GatewayStatus = 'ACTIVE' | 'MAINTENANCE' | 'DISABLED';

export interface PaymentGateway {
  id: string;
  name: string;
  code: string;
  providerType: GatewayProviderType;
  status: GatewayStatus;
  feePercent: number;
  fixedFeePaise: number;
  minAmountPaise: number;
  maxAmountPaise: number;
  dailyLimitPaise: number;
  settlementSla: string;
  priority: number;
  webhookSecretHint: string;
  totalVolumePaise: number;
  totalFeesPaise: number;
  transactionCount: number;
  updatedAt: string;
}

export type AuditEventType =
  | 'DEPOSIT'
  | 'TRANSFER_OUT'
  | 'TRANSFER_IN'
  | 'TABLE_BUYIN'
  | 'TABLE_TOPUP'
  | 'TABLE_CASHOUT'
  | 'GAME_BET'
  | 'GAME_POT_WIN'
  | 'GATEWAY_UPDATE'
  | 'AUTH_LOGIN';

export interface AuditLogEntry {
  id: string;
  sequenceNo: number;
  eventType: AuditEventType;
  actorId: string;
  actorName: string;
  counterpartyId: string | null;
  counterpartyName: string | null;
  gatewayId: string | null;
  gatewayName: string | null;
  tableId: string | null;
  referenceCode: string;
  amountPaise: number;
  feePaise: number;
  balanceBeforePaise: number;
  balanceAfterPaise: number;
  status: string;
  metadata: Record<string, unknown>;
  prevHash: string;
  entryHash: string;
  createdAt: string;
}

export interface AuditChainVerification {
  valid: boolean;
  totalEntries: number;
  checkedEntries: number;
  brokenAtSequence: number | null;
  latestHash: string | null;
  verifiedAt: string;
}

export interface TransactionRecord {
  id: string;
  referenceCode: string;
  type: string;
  userId: string;
  counterpartyId: string | null;
  counterpartyName: string | null;
  gatewayId: string | null;
  gatewayName: string | null;
  tableId: string | null;
  grossAmountPaise: number;
  feePaise: number;
  netAmountPaise: number;
  status: string;
  paymentHandle: string | null;
  note: string | null;
  createdAt: string;
}

export type StakesTierId = 'classic' | 'salon' | 'sovereign' | 'custom';

export interface TableConfig {
  tierId: StakesTierId;
  name: string;
  bootPaise: number;
  minBuyInPaise: number;
  maxBuyInPaise: number;
  chaalLimitPaise: number;
  potLimitPaise: number;
  rakePercent: number;
  maxSeats: number;
  isPrivate: boolean;
  inviteCode?: string;
}

export type TablePhase = 'WAITING' | 'BETTING' | 'SIDESHOW_PENDING' | 'SHOWDOWN';

export interface SeatState {
  seatIndex: number;
  userId: string;
  username: string;
  displayName: string;
  isHouse: boolean;
  connected: boolean;
  stackPaise: number;
  roundContributionPaise: number;
  inRound: boolean;
  isSeen: boolean;
  isPacked: boolean;
  lastAction: string | null;
  cards: Card[] | null; // Null unless revealed to this player or during Showdown
  handEvaluation: HandEvaluation | null;
}

export interface SideshowRequest {
  fromSeatIndex: number;
  fromName: string;
  toSeatIndex: number;
  toName: string;
  stakePaise: number;
  expiresAt: number;
}

export interface RoundWinnerSummary {
  roundNumber: number;
  winnerSeatIndex: number;
  winnerUserId: string;
  winnerName: string;
  potPaise: number;
  rakePaise: number;
  netPayoutPaise: number;
  reason: 'SHOWDOWN' | 'ALL_PACKED' | 'POT_LIMIT';
  winningHandLabel: string | null;
  revealedHands: Array<{
    seatIndex: number;
    displayName: string;
    cards: Card[];
    evaluation: HandEvaluation;
  }>;
}

export interface TableActionFeedItem {
  id: string;
  timestamp: string;
  text: string;
  kind: 'system' | 'bet' | 'win' | 'chat';
  senderName?: string;
}

export interface TableSnapshot {
  id: string;
  config: TableConfig;
  phase: TablePhase;
  roundNumber: number;
  dealerSeatIndex: number;
  currentTurnSeatIndex: number | null;
  turnDeadline: number | null;
  potPaise: number;
  currentStakePaise: number; // Base blind unit; Seen pays 2x this
  seats: Array<SeatState | null>;
  sideshow: SideshowRequest | null;
  lastWinner: RoundWinnerSummary | null;
  nextRoundAt: number | null;
  feed: TableActionFeedItem[];
}

export interface LobbyTableSummary {
  id: string;
  name: string;
  tierId: StakesTierId;
  bootPaise: number;
  minBuyInPaise: number;
  maxBuyInPaise: number;
  potLimitPaise: number;
  playerCount: number;
  humanCount: number;
  maxSeats: number;
  phase: TablePhase;
  isPrivate: boolean;
  inviteCode?: string;
}

export interface LobbySnapshot {
  onlineCount: number;
  queueCounts: Record<StakesTierId, number>;
  tables: LobbyTableSummary[];
}

export type ServerWsMessage =
  | { type: 'connected'; user: UserProfile; lobby: LobbySnapshot }
  | { type: 'lobby:update'; lobby: LobbySnapshot }
  | { type: 'queue:status'; tierId: StakesTierId | null; waitingCount: number }
  | { type: 'table:state'; table: TableSnapshot }
  | { type: 'table:left'; tableId: string; cashOutPaise: number; newBalancePaise: number }
  | { type: 'wallet:update'; balancePaise: number; escrowedPaise: number; notice?: string }
  | { type: 'error'; message: string };

export type ClientWsMessage =
  | { type: 'lobby:subscribe' }
  | { type: 'queue:join'; tierId: StakesTierId; buyInPaise: number }
  | { type: 'queue:leave' }
  | { type: 'table:join'; tableId: string; buyInPaise: number; inviteCode?: string }
  | { type: 'table:leave' }
  | { type: 'table:fill_house' }
  | { type: 'table:start_round' }
  | { type: 'table:topup'; amountPaise: number }
  | { type: 'game:action'; action: 'see' | 'blind' | 'chaal' | 'raise' | 'pack' | 'show' | 'sideshow_request' }
  | { type: 'game:sideshow_response'; accept: boolean }
  | { type: 'table:chat'; text: string };
