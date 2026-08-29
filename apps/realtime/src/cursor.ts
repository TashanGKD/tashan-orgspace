export interface RealtimeEvent {
  sequence: number;
  [key: string]: unknown;
}
export class RealtimeCursorGapError extends Error {
  public constructor() {
    super("realtime history contains a sequence gap");
    this.name = "RealtimeCursorGapError";
  }
}
export class RealtimeCursorSubscription<T extends RealtimeEvent> {
  private cursor: number;
  public constructor(
    afterSequence: number,
    private readonly options: {
      authorize(): Promise<void>;
      load(afterSequence: number): Promise<T[]>;
      emit(event: T): Promise<void> | void;
    },
  ) {
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0)
      throw new Error("realtime cursor is invalid");
    this.cursor = afterSequence;
  }
  public current() {
    return this.cursor;
  }
  public async sync(hintSequence?: number) {
    await this.options.authorize();
    if (hintSequence !== undefined && hintSequence <= this.cursor) return 0;
    const events = (await this.options.load(this.cursor))
      .filter((event) => event.sequence > this.cursor)
      .sort((left, right) => left.sequence - right.sequence);
    if (events[0] && events[0].sequence !== this.cursor + 1) throw new RealtimeCursorGapError();
    let delivered = 0;
    for (const event of events) {
      if (event.sequence !== this.cursor + 1) throw new RealtimeCursorGapError();
      await this.options.emit(event);
      this.cursor = event.sequence;
      delivered += 1;
    }
    if (hintSequence !== undefined && hintSequence > this.cursor)
      throw new RealtimeCursorGapError();
    return delivered;
  }
}
