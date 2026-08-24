import type { Clock } from './clock.js';

export interface LogEntry {
  readonly tijdstip: string;
  readonly niveau: 'warn' | 'error';
  readonly bericht: string;
}

/**
 * In-memory ringbuffer die de laatste warn/error-logregels vasthoudt.
 * Bij herstart is hij leeg — dat is gewenst, elke omgeving is een eigen proces.
 */
export class LogBuffer {
  private readonly entries: (LogEntry | undefined)[];
  private readonly capacity: number;
  private head = 0;
  private size = 0;

  constructor(
    private readonly clock: Clock,
    capacity = 200,
  ) {
    this.capacity = capacity;
    this.entries = new Array<LogEntry | undefined>(capacity).fill(undefined);
  }

  /** Voeg een logregel toe. De oudste verdwijnt als de buffer vol is. */
  add(niveau: 'warn' | 'error', bericht: string): void {
    this.entries[this.head] = {
      tijdstip: this.clock.now().toISOString(),
      niveau,
      bericht,
    };
    this.head = (this.head + 1) % this.capacity;
    if (this.size < this.capacity) {
      this.size++;
    }
  }

  /** Alle entries, nieuwste eerst. */
  recent(): readonly LogEntry[] {
    const result: LogEntry[] = [];
    for (let i = 0; i < this.size; i++) {
      // Loop achterwaarts vanaf het hoofd om nieuwste eerst te krijgen.
      const index = (this.head - 1 - i + this.capacity) % this.capacity;
      const entry = this.entries[index];
      if (entry !== undefined) {
        result.push(entry);
      }
    }
    return result;
  }
}
