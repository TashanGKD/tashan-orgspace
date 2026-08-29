export interface RelayRow {
  globalPosition: number;
  conversationId: string;
  sequence: number;
}
export class DurableEventRelay {
  public constructor(
    private position: number,
    private readonly options: {
      readAfter(globalPosition: number): Promise<RelayRow[]>;
      publish(hint: { conversationId: string; sequence: number }): Promise<void>;
    },
  ) {
    if (!Number.isSafeInteger(position) || position < 0) throw new Error("relay cursor is invalid");
  }
  public current() {
    return this.position;
  }
  public async processOnce() {
    const rows = (await this.options.readAfter(this.position)).sort(
      (left, right) => left.globalPosition - right.globalPosition,
    );
    let published = 0;
    for (const row of rows) {
      if (row.globalPosition <= this.position) continue;
      await this.options.publish({
        conversationId: row.conversationId,
        sequence: row.sequence,
      });
      this.position = row.globalPosition;
      published += 1;
    }
    return published;
  }
}
