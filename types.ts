
export interface Ball {
  number: number;
  owner: string | null;
  paidUntil: string; // ISO date string
}

export interface DrawResult {
  id: string;
  winningNumber: number;
  winnerName: string | null;
  prizeMoney: number;
  charityMoney: number;
  rolloverMoney: number;
  date: string;
}

export interface AppState {
  balls: Ball[];
  history: DrawResult[];
  pricePerBall: number;
  currentRollover: number;
  nextDrawDate: string;
  adminPassword?: string;
  lastAnnouncement?: string;
  lastAnnouncementId?: string;
  aiHistory?: {date: string, number: number}[];
}
