export class Timer {
  private startTime: number;
  private _stopped = false;
  private _elapsed = 0;

  constructor() {
    this.startTime = performance.now();
  }

  stop(): number {
    if (!this._stopped) {
      this._elapsed = performance.now() - this.startTime;
      this._stopped = true;
    }
    return this._elapsed;
  }

  get elapsed(): number {
    return this._stopped ? this._elapsed : performance.now() - this.startTime;
  }
}
