import crypto from 'node:crypto';
import type { WebSocket } from 'ws';
import { compareTeenPattiHands, createShuffledDeck, evaluateTeenPattiHand } from '../src/shared/teenPatti.ts';
import type {
  Card,
  LobbySnapshot,
  LobbyTableSummary,
  RoundWinnerSummary,
  SeatState,
  ServerWsMessage,
  SideshowRequest,
  StakesTierId,
  TableActionFeedItem,
  TableConfig,
  TablePhase,
  TableSnapshot,
} from '../src/shared/types.ts';
import {
  escrowTableBuyIn,
  getUserById,
  releaseTableCashOut,
  syncUserEscrowAndLogRound,
} from './db.ts';

interface InternalSeat {
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
  cards: Card[] | null;
}

interface InternalTable {
  id: string;
  config: TableConfig;
  phase: TablePhase;
  roundNumber: number;
  dealerSeatIndex: number;
  currentTurnSeatIndex: number | null;
  turnDeadline: number | null;
  potPaise: number;
  currentStakePaise: number;
  seats: Array<InternalSeat | null>;
  sideshow: SideshowRequest | null;
  lastWinner: RoundWinnerSummary | null;
  nextRoundAt: number | null;
  feed: TableActionFeedItem[];
  turnTimer: ReturnType<typeof setTimeout> | null;
  houseTimer: ReturnType<typeof setTimeout> | null;
  nextRoundTimer: ReturnType<typeof setTimeout> | null;
}

interface QueueEntry {
  userId: string;
  tierId: StakesTierId;
  buyInPaise: number;
  joinedAt: number;
}

const HOUSE_PROFILES = [
  { id: 'house_vikram', username: 'house_vikram', displayName: 'Vikram (House)' },
  { id: 'house_ananya', username: 'house_ananya', displayName: 'Ananya (House)' },
  { id: 'house_rohan', username: 'house_rohan', displayName: 'Rohan (House)' },
  { id: 'house_devika', username: 'house_devika', displayName: 'Devika (House)' },
];

export const STAKES_TIERS: Record<Exclude<StakesTierId, 'custom'>, TableConfig> = {
  classic: {
    tierId: 'classic',
    name: 'Parlor Classic',
    bootPaise: 5000, // ₹50
    minBuyInPaise: 50000, // ₹500
    maxBuyInPaise: 1000000, // ₹10,000
    chaalLimitPaise: 80000, // ₹800
    potLimitPaise: 1200000, // ₹12,000
    rakePercent: 2,
    maxSeats: 5,
    isPrivate: false,
  },
  salon: {
    tierId: 'salon',
    name: 'High Roller Salon',
    bootPaise: 25000, // ₹250
    minBuyInPaise: 250000, // ₹2,500
    maxBuyInPaise: 5000000, // ₹50,000
    chaalLimitPaise: 400000, // ₹4,000
    potLimitPaise: 6000000, // ₹60,000
    rakePercent: 2,
    maxSeats: 5,
    isPrivate: false,
  },
  sovereign: {
    tierId: 'sovereign',
    name: 'VIP Sovereign',
    bootPaise: 100000, // ₹1,000
    minBuyInPaise: 1000000, // ₹10,000
    maxBuyInPaise: 25000000, // ₹2,50,000
    chaalLimitPaise: 1600000, // ₹16,000
    potLimitPaise: 24000000, // ₹2,40,000
    rakePercent: 1.5,
    maxSeats: 5,
    isPrivate: false,
  },
};

function fmtRs(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

export class TeenPattiGameManager {
  private tables = new Map<string, InternalTable>();
  private userSockets = new Map<string, Set<WebSocket>>();
  private userTableMap = new Map<string, string>();
  private queue = new Map<string, QueueEntry>();

  constructor() {
    this.createTableFromConfig('tbl_classic_1', { ...STAKES_TIERS.classic, name: 'Parlor Classic · Table 1' });
    this.createTableFromConfig('tbl_salon_1', { ...STAKES_TIERS.salon, name: 'High Roller Salon · Table 1' });
    this.createTableFromConfig('tbl_sovereign_1', { ...STAKES_TIERS.sovereign, name: 'VIP Sovereign · Table 1' });
  }

  private createTableFromConfig(id: string, config: TableConfig): InternalTable {
    const table: InternalTable = {
      id,
      config,
      phase: 'WAITING',
      roundNumber: 0,
      dealerSeatIndex: 0,
      currentTurnSeatIndex: null,
      turnDeadline: null,
      potPaise: 0,
      currentStakePaise: config.bootPaise,
      seats: Array.from({ length: config.maxSeats }, () => null),
      sideshow: null,
      lastWinner: null,
      nextRoundAt: null,
      feed: [
        {
          id: crypto.randomBytes(4).toString('hex'),
          timestamp: new Date().toISOString(),
          text: `${config.name} opened · Boot ${fmtRs(config.bootPaise)}`,
          kind: 'system',
        },
      ],
      turnTimer: null,
      houseTimer: null,
      nextRoundTimer: null,
    };
    this.tables.set(id, table);
    return table;
  }

  public createCustomTable(input: {
    name: string;
    bootPaise: number;
    minBuyInPaise: number;
    maxBuyInPaise: number;
    potLimitPaise: number;
    isPrivate: boolean;
  }): LobbyTableSummary {
    const boot = Math.max(1000, Math.min(500000, Math.round(input.bootPaise)));
    const minBuyIn = Math.max(boot * 10, Math.round(input.minBuyInPaise));
    const maxBuyIn = Math.max(minBuyIn * 2, Math.round(input.maxBuyInPaise));
    const potLimit = Math.max(boot * 60, Math.round(input.potLimitPaise));
    const id = `tbl_${crypto.randomBytes(4).toString('hex')}`;
    const inviteCode = input.isPrivate ? crypto.randomBytes(3).toString('hex').toUpperCase() : undefined;

    const table = this.createTableFromConfig(id, {
      tierId: 'custom',
      name: input.name.trim().slice(0, 36) || 'Private Parlor Table',
      bootPaise: boot,
      minBuyInPaise: minBuyIn,
      maxBuyInPaise: maxBuyIn,
      chaalLimitPaise: boot * 16,
      potLimitPaise: potLimit,
      rakePercent: 1.5,
      maxSeats: 5,
      isPrivate: input.isPrivate,
      inviteCode,
    });

    this.broadcastLobby();
    return this.summarizeTable(table);
  }

  public registerConnection(userId: string, ws: WebSocket): void {
    let set = this.userSockets.get(userId);
    if (!set) {
      set = new Set();
      this.userSockets.set(userId, set);
    }
    set.add(ws);

    const user = getUserById(userId);
    if (user) {
      this.sendToSocket(ws, { type: 'connected', user, lobby: this.getLobbySnapshot() });
    }

    // If user is already seated at a table, mark connected and send current table state
    const existingTableId = this.userTableMap.get(userId);
    if (existingTableId) {
      const table = this.tables.get(existingTableId);
      if (table) {
        const seat = table.seats.find((s) => s?.userId === userId);
        if (seat) {
          seat.connected = true;
          this.sendToSocket(ws, { type: 'table:state', table: this.serializeTableForUser(table, userId) });
          this.broadcastTable(table);
        }
      }
    }

    this.broadcastLobby();
  }

  public unregisterConnection(userId: string, ws: WebSocket): void {
    const set = this.userSockets.get(userId);
    if (set) {
      set.delete(ws);
      if (set.size === 0) {
        this.userSockets.delete(userId);
        this.queue.delete(userId);
        const tableId = this.userTableMap.get(userId);
        if (tableId) {
          const table = this.tables.get(tableId);
          const seat = table?.seats.find((s) => s?.userId === userId);
          if (seat) {
            seat.connected = false;
            if (table) this.broadcastTable(table);
          }
        }
      }
    }
    this.broadcastLobby();
  }

  public notifyWalletUpdate(userId: string, notice?: string): void {
    const user = getUserById(userId);
    if (!user) return;
    this.sendToUser(userId, {
      type: 'wallet:update',
      balancePaise: user.balancePaise,
      escrowedPaise: user.escrowedPaise,
      notice,
    });
  }

  public getLobbySnapshot(): LobbySnapshot {
    const queueCounts: Record<StakesTierId, number> = {
      classic: 0,
      salon: 0,
      sovereign: 0,
      custom: 0,
    };
    for (const q of this.queue.values()) {
      queueCounts[q.tierId] = (queueCounts[q.tierId] ?? 0) + 1;
    }

    const tables: LobbyTableSummary[] = [];
    for (const table of this.tables.values()) {
      tables.push(this.summarizeTable(table));
    }

    return {
      onlineCount: Math.max(1, this.userSockets.size),
      queueCounts,
      tables,
    };
  }

  private summarizeTable(table: InternalTable): LobbyTableSummary {
    const occupied = table.seats.filter((s): s is InternalSeat => s !== null);
    const humans = occupied.filter((s) => !s.isHouse);
    return {
      id: table.id,
      name: table.config.name,
      tierId: table.config.tierId,
      bootPaise: table.config.bootPaise,
      minBuyInPaise: table.config.minBuyInPaise,
      maxBuyInPaise: table.config.maxBuyInPaise,
      potLimitPaise: table.config.potLimitPaise,
      playerCount: occupied.length,
      humanCount: humans.length,
      maxSeats: table.config.maxSeats,
      phase: table.phase,
      isPrivate: table.config.isPrivate,
      inviteCode: table.config.inviteCode,
    };
  }

  // Real-time matchmaking queue
  public joinQueue(userId: string, tierId: StakesTierId, buyInPaise: number): void {
    if (tierId === 'custom') {
      this.sendError(userId, 'Join a custom table directly by table ID or invite code.');
      return;
    }
    if (this.userTableMap.has(userId)) {
      this.leaveTable(userId);
    }

    const tier = STAKES_TIERS[tierId];
    const clampedBuyIn = Math.max(tier.minBuyInPaise, Math.min(tier.maxBuyInPaise, Math.round(buyInPaise)));
    const user = getUserById(userId);
    if (!user || user.balancePaise < clampedBuyIn) {
      this.sendError(userId, `Insufficient wallet balance. Need at least ${fmtRs(clampedBuyIn)} to enter ${tier.name}.`);
      return;
    }

    // Try immediate real-time seating at an active public table of this tier with an open seat
    let targetTable: InternalTable | null = null;
    for (const t of this.tables.values()) {
      if (t.config.tierId === tierId && !t.config.isPrivate) {
        const hasOpenSeat = t.seats.some((s) => s === null);
        const hasReplaceableHouse = t.phase === 'WAITING' && t.seats.some((s) => s?.isHouse);
        if (hasOpenSeat || hasReplaceableHouse) {
          targetTable = t;
          break;
        }
      }
    }

    if (!targetTable) {
      const count = Array.from(this.tables.values()).filter((t) => t.config.tierId === tierId).length + 1;
      targetTable = this.createTableFromConfig(`tbl_${tierId}_${count}`, {
        ...tier,
        name: `${tier.name} · Table ${count}`,
      });
    }

    this.queue.delete(userId);
    this.sendToUser(userId, { type: 'queue:status', tierId: null, waitingCount: 0 });
    this.joinTable(userId, targetTable.id, clampedBuyIn);
  }

  public leaveQueue(userId: string): void {
    this.queue.delete(userId);
    this.sendToUser(userId, { type: 'queue:status', tierId: null, waitingCount: 0 });
    this.broadcastLobby();
  }

  public joinTable(userId: string, tableId: string, buyInPaise: number, inviteCode?: string): void {
    const table = this.tables.get(tableId);
    if (!table) {
      this.sendError(userId, 'Table no longer exists.');
      return;
    }

    // Already seated at this table? Just sync
    const existingSeat = table.seats.find((s) => s?.userId === userId);
    if (existingSeat) {
      existingSeat.connected = true;
      this.sendToUser(userId, { type: 'table:state', table: this.serializeTableForUser(table, userId) });
      return;
    }

    if (table.config.isPrivate && table.config.inviteCode) {
      if (!inviteCode || inviteCode.trim().toUpperCase() !== table.config.inviteCode) {
        this.sendError(userId, 'Invalid invite code for private table.');
        return;
      }
    }

    // Leave any other table first
    if (this.userTableMap.has(userId)) {
      this.leaveTable(userId);
    }

    const buyIn = Math.round(buyInPaise);
    if (buyIn < table.config.minBuyInPaise || buyIn > table.config.maxBuyInPaise) {
      this.sendError(
        userId,
        `Buy-in must be between ${fmtRs(table.config.minBuyInPaise)} and ${fmtRs(table.config.maxBuyInPaise)}.`
      );
      return;
    }

    let seatIdx = table.seats.findIndex((s) => s === null);
    // If full but a House seat can be freed during WAITING, yield seat to the real player
    if (seatIdx === -1 && table.phase === 'WAITING') {
      seatIdx = table.seats.findIndex((s) => s?.isHouse);
    }
    if (seatIdx === -1) {
      this.sendError(userId, 'Table is full. Join another table or create one.');
      return;
    }

    try {
      const updatedUser = escrowTableBuyIn(userId, table.id, buyIn, false);
      table.seats[seatIdx] = {
        seatIndex: seatIdx,
        userId: updatedUser.id,
        username: updatedUser.username,
        displayName: updatedUser.displayName,
        isHouse: false,
        connected: true,
        stackPaise: buyIn,
        roundContributionPaise: 0,
        inRound: false,
        isSeen: false,
        isPacked: false,
        lastAction: 'Seated',
        cards: null,
      };
      this.userTableMap.set(userId, table.id);
      this.pushFeed(table, `${updatedUser.displayName} joined Seat ${seatIdx + 1} with ${fmtRs(buyIn)}`, 'system');
      this.notifyWalletUpdate(userId);
      this.broadcastTable(table);
      this.broadcastLobby();

      // If 2+ funded players are now seated and table is WAITING, start round after brief beat
      if (table.phase === 'WAITING' && this.getFundedSeats(table).length >= 2) {
        this.scheduleNextRound(table, 2200);
      }
    } catch (err) {
      this.sendError(userId, err instanceof Error ? err.message : 'Unable to join table.');
    }
  }

  public fillHouseSeats(userId: string): void {
    const tableId = this.userTableMap.get(userId);
    if (!tableId) return;
    const table = this.tables.get(tableId);
    if (!table) return;

    const existingIds = new Set(table.seats.filter((s): s is InternalSeat => s !== null).map((s) => s.userId));
    let added = 0;

    for (const profile of HOUSE_PROFILES) {
      const currentCount = table.seats.filter((s) => s !== null).length;
      if (currentCount >= 4) break; // Keep 1 seat open for incoming live players
      if (existingIds.has(profile.id)) continue;
      const openIdx = table.seats.findIndex((s) => s === null);
      if (openIdx === -1) break;

      const houseStack = Math.min(table.config.maxBuyInPaise, table.config.minBuyInPaise * 3);
      table.seats[openIdx] = {
        seatIndex: openIdx,
        userId: profile.id,
        username: profile.username,
        displayName: profile.displayName,
        isHouse: true,
        connected: true,
        stackPaise: houseStack,
        roundContributionPaise: 0,
        inRound: false,
        isSeen: false,
        isPacked: false,
        lastAction: 'Ready',
        cards: null,
      };
      existingIds.add(profile.id);
      added++;
    }

    if (added > 0) {
      this.pushFeed(table, `${added} House challenger${added > 1 ? 's' : ''} took open seats`, 'system');
      this.broadcastTable(table);
      this.broadcastLobby();
      if (table.phase === 'WAITING' && this.getFundedSeats(table).length >= 2) {
        this.startRound(table);
      }
    }
  }

  public topUpTableStack(userId: string, amountPaise: number): void {
    const tableId = this.userTableMap.get(userId);
    if (!tableId) {
      this.sendError(userId, 'You are not seated at a table.');
      return;
    }
    const table = this.tables.get(tableId);
    if (!table) return;
    const seat = table.seats.find((s) => s?.userId === userId);
    if (!seat) return;

    const amt = Math.round(amountPaise);
    if (amt < table.config.bootPaise * 2) {
      this.sendError(userId, `Minimum top-up is ${fmtRs(table.config.bootPaise * 2)}.`);
      return;
    }
    if (seat.stackPaise + amt > table.config.maxBuyInPaise) {
      this.sendError(userId, `Table stack cannot exceed ${fmtRs(table.config.maxBuyInPaise)}.`);
      return;
    }

    try {
      escrowTableBuyIn(userId, table.id, amt, true);
      seat.stackPaise += amt;
      this.pushFeed(table, `${seat.displayName} topped up ${fmtRs(amt)}`, 'system');
      this.notifyWalletUpdate(userId, `Added ${fmtRs(amt)} to table stack`);
      this.broadcastTable(table);
    } catch (err) {
      this.sendError(userId, err instanceof Error ? err.message : 'Top-up failed.');
    }
  }

  public leaveTable(userId: string): void {
    const tableId = this.userTableMap.get(userId);
    if (!tableId) return;
    const table = this.tables.get(tableId);
    this.userTableMap.delete(userId);
    if (!table) return;

    const seatIdx = table.seats.findIndex((s) => s?.userId === userId);
    if (seatIdx === -1) return;
    const seat = table.seats[seatIdx]!;

    // If leaving mid-round, pack their hand cleanly first
    if (table.phase === 'BETTING' || table.phase === 'SIDESHOW_PENDING') {
      if (seat.inRound && !seat.isPacked) {
        seat.isPacked = true;
        seat.lastAction = 'Left & Packed';
        if (table.sideshow && (table.sideshow.fromSeatIndex === seatIdx || table.sideshow.toSeatIndex === seatIdx)) {
          table.sideshow = null;
          table.phase = 'BETTING';
        }
      }
    }

    const cashOutPaise = seat.stackPaise;
    table.seats[seatIdx] = null;

    const updatedUser = releaseTableCashOut(userId, table.id, cashOutPaise);
    this.pushFeed(table, `${seat.displayName} cashed out ${fmtRs(cashOutPaise)} and left`, 'system');

    this.sendToUser(userId, {
      type: 'table:left',
      tableId: table.id,
      cashOutPaise,
      newBalancePaise: updatedUser.balancePaise,
    });
    this.notifyWalletUpdate(userId);

    // If no humans remain at this table, clear House players and reset to WAITING
    const remainingHumans = table.seats.filter((s) => s !== null && !s.isHouse);
    if (remainingHumans.length === 0) {
      this.clearTableTimers(table);
      table.seats = table.seats.map(() => null);
      table.phase = 'WAITING';
      table.currentTurnSeatIndex = null;
      table.turnDeadline = null;
      table.potPaise = 0;
      table.sideshow = null;
      table.lastWinner = null;
      table.nextRoundAt = null;
    } else if (table.phase === 'BETTING') {
      const active = this.getActiveRoundSeats(table);
      if (active.length <= 1) {
        this.finishRoundByPack(table);
      } else if (table.currentTurnSeatIndex === seatIdx) {
        this.advanceTurn(table, seatIdx);
      }
    }

    this.broadcastTable(table);
    this.broadcastLobby();
  }

  public requestManualStart(userId: string): void {
    const tableId = this.userTableMap.get(userId);
    if (!tableId) return;
    const table = this.tables.get(tableId);
    if (!table) return;
    if (table.phase !== 'WAITING' && table.phase !== 'SHOWDOWN') return;
    if (this.getFundedSeats(table).length < 2) {
      this.sendError(userId, 'At least 2 funded players are required to deal a hand.');
      return;
    }
    this.startRound(table);
  }

  public handleChat(userId: string, rawText: string): void {
    const tableId = this.userTableMap.get(userId);
    if (!tableId) return;
    const table = this.tables.get(tableId);
    if (!table) return;
    const seat = table.seats.find((s) => s?.userId === userId);
    if (!seat) return;
    const text = rawText.trim().slice(0, 140);
    if (!text) return;

    this.pushFeed(table, text, 'chat', seat.displayName);
    this.broadcastTable(table);
  }

  private getFundedSeats(table: InternalTable): InternalSeat[] {
    return table.seats.filter(
      (s): s is InternalSeat => s !== null && s.stackPaise >= table.config.bootPaise
    );
  }

  private getActiveRoundSeats(table: InternalTable): InternalSeat[] {
    return table.seats.filter(
      (s): s is InternalSeat => s !== null && s.inRound && !s.isPacked
    );
  }

  private clearTableTimers(table: InternalTable): void {
    if (table.turnTimer) {
      clearTimeout(table.turnTimer);
      table.turnTimer = null;
    }
    if (table.houseTimer) {
      clearTimeout(table.houseTimer);
      table.houseTimer = null;
    }
    if (table.nextRoundTimer) {
      clearTimeout(table.nextRoundTimer);
      table.nextRoundTimer = null;
    }
  }

  private scheduleNextRound(table: InternalTable, delayMs: number): void {
    if (table.nextRoundTimer) {
      clearTimeout(table.nextRoundTimer);
      table.nextRoundTimer = null;
    }
    table.nextRoundAt = Date.now() + delayMs;
    this.broadcastTable(table);
    table.nextRoundTimer = setTimeout(() => {
      table.nextRoundTimer = null;
      table.nextRoundAt = null;
      // Top up broke house seats automatically between hands
      for (const s of table.seats) {
        if (s && s.isHouse && s.stackPaise < table.config.bootPaise * 6) {
          s.stackPaise = table.config.minBuyInPaise * 3;
        }
      }
      if (this.getFundedSeats(table).length >= 2) {
        this.startRound(table);
      } else {
        table.phase = 'WAITING';
        this.broadcastTable(table);
      }
    }, delayMs);
  }

  private startRound(table: InternalTable): void {
    this.clearTableTimers(table);
    const funded = this.getFundedSeats(table);
    if (funded.length < 2) {
      table.phase = 'WAITING';
      table.nextRoundAt = null;
      this.broadcastTable(table);
      return;
    }

    const deck = createShuffledDeck();
    table.roundNumber += 1;
    table.phase = 'BETTING';
    table.potPaise = 0;
    table.currentStakePaise = table.config.bootPaise;
    table.sideshow = null;
    table.lastWinner = null;
    table.nextRoundAt = null;

    // Rotate dealer seat
    const occupiedIndices = funded.map((s) => s.seatIndex);
    const nextDealer =
      occupiedIndices.find((idx) => idx > table.dealerSeatIndex) ?? occupiedIndices[0];
    table.dealerSeatIndex = nextDealer;

    for (const s of table.seats) {
      if (!s) continue;
      if (s.stackPaise >= table.config.bootPaise) {
        s.stackPaise -= table.config.bootPaise;
        s.roundContributionPaise = table.config.bootPaise;
        s.inRound = true;
        s.isSeen = false;
        s.isPacked = false;
        s.lastAction = `Boot ${fmtRs(table.config.bootPaise)}`;
        s.cards = [deck.pop()!, deck.pop()!, deck.pop()!];
        table.potPaise += table.config.bootPaise;
      } else {
        s.inRound = false;
        s.isSeen = false;
        s.isPacked = true;
        s.roundContributionPaise = 0;
        s.lastAction = 'Low Chips';
        s.cards = null;
      }
    }

    this.pushFeed(
      table,
      `Round #${table.roundNumber} dealt · Boot ${fmtRs(table.config.bootPaise)} · Pot ${fmtRs(table.potPaise)}`,
      'system'
    );

    const firstTurn = this.findNextActiveSeatIndex(table, table.dealerSeatIndex);
    this.setTurn(table, firstTurn);
    this.broadcastTable(table);
    this.broadcastLobby();
  }

  private findNextActiveSeatIndex(table: InternalTable, afterIndex: number): number | null {
    const n = table.seats.length;
    for (let offset = 1; offset <= n; offset++) {
      const idx = (afterIndex + offset) % n;
      const s = table.seats[idx];
      if (s && s.inRound && !s.isPacked) {
        return idx;
      }
    }
    return null;
  }

  private findPreviousActiveSeatIndex(table: InternalTable, beforeIndex: number): number | null {
    const n = table.seats.length;
    for (let offset = 1; offset <= n; offset++) {
      const idx = (beforeIndex - offset + n) % n;
      const s = table.seats[idx];
      if (s && s.inRound && !s.isPacked) {
        return idx;
      }
    }
    return null;
  }

  private setTurn(table: InternalTable, seatIndex: number | null): void {
    if (table.turnTimer) {
      clearTimeout(table.turnTimer);
      table.turnTimer = null;
    }
    if (table.houseTimer) {
      clearTimeout(table.houseTimer);
      table.houseTimer = null;
    }

    table.currentTurnSeatIndex = seatIndex;
    if (seatIndex === null) {
      table.turnDeadline = null;
      return;
    }

    const seat = table.seats[seatIndex];
    if (!seat) return;

    const turnMs = 25000;
    table.turnDeadline = Date.now() + turnMs;

    if (seat.isHouse) {
      table.houseTimer = setTimeout(() => {
        table.houseTimer = null;
        this.executeHouseTurn(table, seatIndex);
      }, 950 + Math.floor(Math.random() * 650));
    } else {
      table.turnTimer = setTimeout(() => {
        table.turnTimer = null;
        if (table.phase === 'BETTING' && table.currentTurnSeatIndex === seatIndex) {
          this.pushFeed(table, `${seat.displayName} timed out and packed`, 'bet');
          this.performGameAction(seat.userId, 'pack');
        }
      }, turnMs);
    }
  }

  private advanceTurn(table: InternalTable, fromSeatIndex: number): void {
    const active = this.getActiveRoundSeats(table);
    if (active.length <= 1) {
      this.finishRoundByPack(table);
      return;
    }
    if (table.potPaise >= table.config.potLimitPaise) {
      this.finishRoundByShowdown(table, 'POT_LIMIT');
      return;
    }

    const nextIdx = this.findNextActiveSeatIndex(table, fromSeatIndex);
    this.setTurn(table, nextIdx);
    this.broadcastTable(table);
  }

  public performGameAction(
    userId: string,
    action: 'see' | 'blind' | 'chaal' | 'raise' | 'pack' | 'show' | 'sideshow_request'
  ): void {
    const tableId = this.userTableMap.get(userId);
    if (!tableId) return;
    const table = this.tables.get(tableId);
    if (!table) return;

    const seatIdx = table.seats.findIndex((s) => s?.userId === userId);
    if (seatIdx === -1) return;
    const seat = table.seats[seatIdx]!;

    // Seeing cards is allowed at any moment during BETTING while in round & not packed
    if (action === 'see') {
      if (table.phase !== 'BETTING' && table.phase !== 'SIDESHOW_PENDING') return;
      if (!seat.inRound || seat.isPacked || seat.isSeen) return;
      seat.isSeen = true;
      seat.lastAction = 'Seen Cards';
      this.pushFeed(table, `${seat.displayName} looked at their cards`, 'bet');
      this.broadcastTable(table);
      return;
    }

    if (table.phase !== 'BETTING') {
      this.sendError(userId, 'Waiting for round or sideshow resolution.');
      return;
    }
    if (table.currentTurnSeatIndex !== seatIdx) {
      this.sendError(userId, 'It is not your turn.');
      return;
    }

    this.applySeatAction(table, seatIdx, action);
  }

  private applySeatAction(
    table: InternalTable,
    seatIdx: number,
    action: 'blind' | 'chaal' | 'raise' | 'pack' | 'show' | 'sideshow_request'
  ): void {
    const seat = table.seats[seatIdx];
    if (!seat || !seat.inRound || seat.isPacked) return;
    const active = this.getActiveRoundSeats(table);

    if (action === 'pack') {
      seat.isPacked = true;
      seat.lastAction = 'Packed';
      this.pushFeed(table, `${seat.displayName} packed`, 'bet');
      this.advanceTurn(table, seatIdx);
      return;
    }

    const baseBet = seat.isSeen ? table.currentStakePaise * 2 : table.currentStakePaise;

    if (action === 'blind' || action === 'chaal') {
      if (action === 'blind' && seat.isSeen) {
        this.sendError(seat.userId, 'Seen players must play Chaal.');
        return;
      }
      const bet = Math.min(baseBet, seat.stackPaise);
      if (bet <= 0) {
        seat.isPacked = true;
        seat.lastAction = 'All-In Pack';
        this.advanceTurn(table, seatIdx);
        return;
      }
      seat.stackPaise -= bet;
      seat.roundContributionPaise += bet;
      table.potPaise += bet;
      seat.lastAction = `${seat.isSeen ? 'Chaal' : 'Blind'} ${fmtRs(bet)}`;
      this.pushFeed(table, `${seat.displayName} played ${seat.lastAction}`, 'bet');
      this.advanceTurn(table, seatIdx);
      return;
    }

    if (action === 'raise') {
      const doubledUnit = Math.min(table.config.chaalLimitPaise / 2, table.currentStakePaise * 2);
      const nextBet = seat.isSeen ? doubledUnit * 2 : doubledUnit;
      if (nextBet <= baseBet) {
        this.sendError(seat.userId, 'Table Chaal limit reached.');
        return;
      }
      if (seat.stackPaise < nextBet) {
        this.sendError(seat.userId, `Need ${fmtRs(nextBet)} in table stack to raise 2x.`);
        return;
      }
      table.currentStakePaise = doubledUnit;
      seat.stackPaise -= nextBet;
      seat.roundContributionPaise += nextBet;
      table.potPaise += nextBet;
      seat.lastAction = `Raised ${fmtRs(nextBet)}`;
      this.pushFeed(table, `${seat.displayName} raised 2x to ${fmtRs(nextBet)}`, 'bet');
      this.advanceTurn(table, seatIdx);
      return;
    }

    if (action === 'show') {
      if (active.length !== 2) {
        this.sendError(seat.userId, 'Show is only available when 2 active players remain.');
        return;
      }
      const opponent = active.find((s) => s.seatIndex !== seatIdx)!;
      if (seat.isSeen && !opponent.isSeen) {
        this.sendError(seat.userId, 'Cannot call Show against a Blind player while Seen.');
        return;
      }
      const showCost = Math.min(baseBet, seat.stackPaise);
      seat.stackPaise -= showCost;
      seat.roundContributionPaise += showCost;
      table.potPaise += showCost;
      seat.lastAction = `Show ${fmtRs(showCost)}`;
      this.pushFeed(table, `${seat.displayName} called Show for ${fmtRs(showCost)}`, 'bet');
      this.finishRoundByShowdown(table, 'SHOWDOWN');
      return;
    }

    if (action === 'sideshow_request') {
      if (active.length <= 2) {
        this.sendError(seat.userId, 'Use Show when only 2 active players remain.');
        return;
      }
      if (!seat.isSeen) {
        this.sendError(seat.userId, 'You must see your cards before requesting a Sideshow.');
        return;
      }
      const prevIdx = this.findPreviousActiveSeatIndex(table, seatIdx);
      const prevSeat = prevIdx !== null ? table.seats[prevIdx] : null;
      if (!prevSeat || !prevSeat.isSeen) {
        this.sendError(seat.userId, 'Sideshow requires the previous active player to be Seen.');
        return;
      }
      if (seat.stackPaise < baseBet) {
        this.sendError(seat.userId, `Need ${fmtRs(baseBet)} to request Sideshow.`);
        return;
      }

      seat.stackPaise -= baseBet;
      seat.roundContributionPaise += baseBet;
      table.potPaise += baseBet;
      seat.lastAction = `Sideshow (${fmtRs(baseBet)})`;
      table.phase = 'SIDESHOW_PENDING';
      table.sideshow = {
        fromSeatIndex: seatIdx,
        fromName: seat.displayName,
        toSeatIndex: prevSeat.seatIndex,
        toName: prevSeat.displayName,
        stakePaise: baseBet,
        expiresAt: Date.now() + 15000,
      };
      this.pushFeed(
        table,
        `${seat.displayName} requested a Sideshow with ${prevSeat.displayName}`,
        'bet'
      );
      this.broadcastTable(table);

      if (prevSeat.isHouse) {
        table.houseTimer = setTimeout(() => {
          table.houseTimer = null;
          this.resolveSideshow(table, prevSeat.seatIndex, true);
        }, 900);
      } else {
        if (table.turnTimer) clearTimeout(table.turnTimer);
        table.turnTimer = setTimeout(() => {
          if (table.phase === 'SIDESHOW_PENDING' && table.sideshow) {
            this.resolveSideshow(table, prevSeat.seatIndex, false);
          }
        }, 15000);
      }
    }
  }

  public respondSideshow(userId: string, accept: boolean): void {
    const tableId = this.userTableMap.get(userId);
    if (!tableId) return;
    const table = this.tables.get(tableId);
    if (!table || table.phase !== 'SIDESHOW_PENDING' || !table.sideshow) return;

    const targetSeat = table.seats[table.sideshow.toSeatIndex];
    if (!targetSeat || targetSeat.userId !== userId) return;
    this.resolveSideshow(table, targetSeat.seatIndex, accept);
  }

  private resolveSideshow(table: InternalTable, responderSeatIdx: number, accept: boolean): void {
    const req = table.sideshow;
    if (!req || req.toSeatIndex !== responderSeatIdx) return;
    const fromSeat = table.seats[req.fromSeatIndex];
    const toSeat = table.seats[req.toSeatIndex];
    table.sideshow = null;
    table.phase = 'BETTING';

    if (!fromSeat || !toSeat || !fromSeat.cards || !toSeat.cards) {
      this.advanceTurn(table, req.fromSeatIndex);
      return;
    }

    if (!accept) {
      toSeat.lastAction = 'Declined Sideshow';
      this.pushFeed(table, `${toSeat.displayName} declined the Sideshow`, 'bet');
      this.advanceTurn(table, req.fromSeatIndex);
      return;
    }

    const fromEval = evaluateTeenPattiHand(fromSeat.cards);
    const toEval = evaluateTeenPattiHand(toSeat.cards);
    const cmp = compareTeenPattiHands(fromEval, toEval);

    // Authentic rule: tie goes to the player who received the sideshow request
    if (cmp > 0) {
      toSeat.isPacked = true;
      toSeat.lastAction = 'Lost Sideshow';
      fromSeat.lastAction = 'Won Sideshow';
      this.pushFeed(table, `${fromSeat.displayName} won the Sideshow against ${toSeat.displayName}`, 'win');
    } else {
      fromSeat.isPacked = true;
      fromSeat.lastAction = 'Lost Sideshow';
      toSeat.lastAction = 'Won Sideshow';
      this.pushFeed(table, `${toSeat.displayName} won the Sideshow against ${fromSeat.displayName}`, 'win');
    }

    this.advanceTurn(table, req.fromSeatIndex);
  }

  private executeHouseTurn(table: InternalTable, seatIdx: number): void {
    if (table.phase !== 'BETTING' || table.currentTurnSeatIndex !== seatIdx) return;
    const seat = table.seats[seatIdx];
    if (!seat || !seat.isHouse || !seat.cards) return;

    const active = this.getActiveRoundSeats(table);
    const evalHand = evaluateTeenPattiHand(seat.cards);

    // House player occasionally stays blind for first move, otherwise sees cards
    if (!seat.isSeen && Math.random() < 0.62) {
      seat.isSeen = true;
    }

    const baseBet = seat.isSeen ? table.currentStakePaise * 2 : table.currentStakePaise;

    // If only 2 players left and strong hand or large pot, consider Show
    if (active.length === 2) {
      const opp = active.find((s) => s.seatIndex !== seatIdx)!;
      const canShow = !seat.isSeen || opp.isSeen;
      if (canShow && (table.potPaise >= table.config.bootPaise * 14 || Math.random() < 0.32)) {
        this.applySeatAction(table, seatIdx, 'show');
        return;
      }
    }

    // Weak hand & high stakes -> fold sometimes
    if (seat.isSeen && evalHand.categoryRank === 1 && evalHand.tiebreakers[0] < 11) {
      if (baseBet >= table.config.bootPaise * 4 || Math.random() < 0.45) {
        this.applySeatAction(table, seatIdx, 'pack');
        return;
      }
    }

    // Strong hand (Pair J+ or Color+) -> occasional raise
    if (
      (evalHand.categoryRank >= 3 || (evalHand.categoryRank === 2 && evalHand.tiebreakers[0] >= 10)) &&
      table.currentStakePaise * 2 <= table.config.chaalLimitPaise / 2 &&
      seat.stackPaise >= baseBet * 2 &&
      Math.random() < 0.35
    ) {
      this.applySeatAction(table, seatIdx, 'raise');
      return;
    }

    if (seat.stackPaise < baseBet) {
      this.applySeatAction(table, seatIdx, 'pack');
      return;
    }

    this.applySeatAction(table, seatIdx, seat.isSeen ? 'chaal' : 'blind');
  }

  private finishRoundByPack(table: InternalTable): void {
    this.clearTableTimers(table);
    const active = this.getActiveRoundSeats(table);
    const winner = active[0];
    if (!winner) {
      table.phase = 'WAITING';
      this.broadcastTable(table);
      return;
    }

    const rakePaise = Math.round((table.potPaise * table.config.rakePercent) / 100);
    const netPayoutPaise = table.potPaise - rakePaise;
    winner.stackPaise += netPayoutPaise;
    winner.lastAction = `Won ${fmtRs(netPayoutPaise)}`;

    table.phase = 'SHOWDOWN';
    table.currentTurnSeatIndex = null;
    table.turnDeadline = null;
    table.lastWinner = {
      roundNumber: table.roundNumber,
      winnerSeatIndex: winner.seatIndex,
      winnerUserId: winner.userId,
      winnerName: winner.displayName,
      potPaise: table.potPaise,
      rakePaise,
      netPayoutPaise,
      reason: 'ALL_PACKED',
      winningHandLabel: null,
      revealedHands: [],
    };

    this.settleRoundInDatabase(table, winner, rakePaise, netPayoutPaise, null);
    this.pushFeed(table, `${winner.displayName} won ${fmtRs(netPayoutPaise)} (all others packed)`, 'win');
    this.scheduleNextRound(table, 5500);
  }

  private finishRoundByShowdown(table: InternalTable, reason: 'SHOWDOWN' | 'POT_LIMIT'): void {
    this.clearTableTimers(table);
    const contenders = this.getActiveRoundSeats(table).filter((s) => s.cards !== null);
    if (contenders.length === 0) {
      table.phase = 'WAITING';
      this.broadcastTable(table);
      return;
    }

    const evaluated = contenders.map((seat) => ({
      seat,
      evaluation: evaluateTeenPattiHand(seat.cards!),
    }));

    evaluated.sort((a, b) => compareTeenPattiHands(b.evaluation, a.evaluation));
    const winnerEntry = evaluated[0];
    const winner = winnerEntry.seat;

    const rakePaise = Math.round((table.potPaise * table.config.rakePercent) / 100);
    const netPayoutPaise = table.potPaise - rakePaise;
    winner.stackPaise += netPayoutPaise;
    winner.lastAction = `Won ${fmtRs(netPayoutPaise)}`;

    table.phase = 'SHOWDOWN';
    table.currentTurnSeatIndex = null;
    table.turnDeadline = null;
    table.lastWinner = {
      roundNumber: table.roundNumber,
      winnerSeatIndex: winner.seatIndex,
      winnerUserId: winner.userId,
      winnerName: winner.displayName,
      potPaise: table.potPaise,
      rakePaise,
      netPayoutPaise,
      reason,
      winningHandLabel: winnerEntry.evaluation.label,
      revealedHands: evaluated.map((e) => ({
        seatIndex: e.seat.seatIndex,
        displayName: e.seat.displayName,
        cards: e.seat.cards!,
        evaluation: e.evaluation,
      })),
    };

    this.settleRoundInDatabase(table, winner, rakePaise, netPayoutPaise, winnerEntry.evaluation.label);
    this.pushFeed(
      table,
      `${winner.displayName} won ${fmtRs(netPayoutPaise)} with ${winnerEntry.evaluation.label}`,
      'win'
    );
    this.scheduleNextRound(table, 6500);
  }

  private settleRoundInDatabase(
    table: InternalTable,
    winner: InternalSeat,
    rakePaise: number,
    netPayoutPaise: number,
    winningHandLabel: string | null
  ): void {
    const participants = table.seats
      .filter((s): s is InternalSeat => s !== null && s.inRound)
      .map((s) => ({
        userId: s.userId,
        displayName: s.displayName,
        isHouse: s.isHouse,
        contributedPaise: s.roundContributionPaise,
        newStackPaise: s.stackPaise,
      }));

    syncUserEscrowAndLogRound({
      tableId: table.id,
      roundNumber: table.roundNumber,
      winnerUserId: winner.userId,
      winnerDisplayName: winner.displayName,
      winnerIsHouse: winner.isHouse,
      potPaise: table.potPaise,
      rakePaise,
      netPayoutPaise,
      winningHandLabel,
      participants,
    });

    for (const p of participants) {
      if (!p.isHouse) {
        this.notifyWalletUpdate(p.userId);
      }
    }
  }

  private pushFeed(
    table: InternalTable,
    text: string,
    kind: TableActionFeedItem['kind'],
    senderName?: string
  ): void {
    table.feed.push({
      id: crypto.randomBytes(4).toString('hex'),
      timestamp: new Date().toISOString(),
      text,
      kind,
      senderName,
    });
    if (table.feed.length > 40) {
      table.feed.shift();
    }
  }

  private serializeTableForUser(table: InternalTable, viewerUserId: string): TableSnapshot {
    const isShowdownReveal =
      table.phase === 'SHOWDOWN' &&
      table.lastWinner !== null &&
      table.lastWinner.reason !== 'ALL_PACKED';

    const seats: Array<SeatState | null> = table.seats.map((s) => {
      if (!s) return null;
      const isViewer = s.userId === viewerUserId;
      const showCards =
        s.cards !== null &&
        ((isViewer && s.isSeen) || (isShowdownReveal && s.inRound && !s.isPacked));

      return {
        seatIndex: s.seatIndex,
        userId: s.userId,
        username: s.username,
        displayName: s.displayName,
        isHouse: s.isHouse,
        connected: s.connected,
        stackPaise: s.stackPaise,
        roundContributionPaise: s.roundContributionPaise,
        inRound: s.inRound,
        isSeen: s.isSeen,
        isPacked: s.isPacked,
        lastAction: s.lastAction,
        cards: showCards ? s.cards : null,
        handEvaluation: showCards && s.cards ? evaluateTeenPattiHand(s.cards) : null,
      };
    });

    return {
      id: table.id,
      config: table.config,
      phase: table.phase,
      roundNumber: table.roundNumber,
      dealerSeatIndex: table.dealerSeatIndex,
      currentTurnSeatIndex: table.currentTurnSeatIndex,
      turnDeadline: table.turnDeadline,
      potPaise: table.potPaise,
      currentStakePaise: table.currentStakePaise,
      seats,
      sideshow: table.sideshow,
      lastWinner: table.lastWinner,
      nextRoundAt: table.nextRoundAt,
      feed: table.feed,
    };
  }

  private broadcastTable(table: InternalTable): void {
    for (const s of table.seats) {
      if (!s || s.isHouse) continue;
      this.sendToUser(s.userId, {
        type: 'table:state',
        table: this.serializeTableForUser(table, s.userId),
      });
    }
  }

  private broadcastLobby(): void {
    const lobby = this.getLobbySnapshot();
    for (const sockets of this.userSockets.values()) {
      for (const ws of sockets) {
        this.sendToSocket(ws, { type: 'lobby:update', lobby });
      }
    }
  }

  private sendError(userId: string, message: string): void {
    this.sendToUser(userId, { type: 'error', message });
  }

  private sendToUser(userId: string, msg: ServerWsMessage): void {
    const sockets = this.userSockets.get(userId);
    if (!sockets) return;
    for (const ws of sockets) {
      this.sendToSocket(ws, msg);
    }
  }

  private sendToSocket(ws: WebSocket, msg: ServerWsMessage): void {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify(msg));
    }
  }
}
