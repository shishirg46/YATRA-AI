/**
 * Binary min-heap priority queue for Dijkstra/A*.
 * O(log n) push/pop instead of O(n) linear scan.
 */

export type HeapItem = {
  key: string;
  priority: number;
};

export class MinPriorityQueue {
  private heap: HeapItem[] = [];
  private indices = new Map<string, number>();

  get size(): number {
    return this.heap.length;
  }

  push(key: string, priority: number): void {
    const i = this.indices.get(key);
    if (i !== undefined) {
      if (priority < this.heap[i].priority) {
        this.heap[i].priority = priority;
        this.bubbleUp(i);
      }
      return;
    }
    this.heap.push({ key, priority });
    this.indices.set(key, this.heap.length - 1);
    this.bubbleUp(this.heap.length - 1);
  }

  pop(): HeapItem | null {
    if (this.heap.length === 0) return null;
    const top = this.heap[0];
    const last = this.heap.pop()!;
    this.indices.delete(top.key);
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.indices.set(last.key, 0);
      this.sinkDown(0);
    }
    return top;
  }

  private bubbleUp(idx: number): void {
    while (idx > 0) {
      const parent = (idx - 1) >> 1;
      if (this.heap[idx].priority >= this.heap[parent].priority) break;
      this.swap(idx, parent);
      idx = parent;
    }
  }

  private sinkDown(idx: number): void {
    const n = this.heap.length;
    while (true) {
      let smallest = idx;
      const left = (idx << 1) + 1;
      const right = left + 1;
      if (left < n && this.heap[left].priority < this.heap[smallest].priority) smallest = left;
      if (right < n && this.heap[right].priority < this.heap[smallest].priority) smallest = right;
      if (smallest === idx) break;
      this.swap(idx, smallest);
      idx = smallest;
    }
  }

  private swap(i: number, j: number): void {
    const a = this.heap[i];
    const b = this.heap[j];
    this.heap[i] = b;
    this.heap[j] = a;
    this.indices.set(a.key, j);
    this.indices.set(b.key, i);
  }
}
