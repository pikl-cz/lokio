/**
 * Minimal, dependency-free typed event bus used by the Workspace.
 */

export type EventMap = Record<string, unknown[]>;

export type EventListener<Args extends unknown[]> = (...args: Args) => void;

export class EventBus<Events extends EventMap> {
  private readonly listeners = new Map<keyof Events, Set<EventListener<never>>>();

  on<K extends keyof Events>(event: K, listener: EventListener<Events[K]>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as EventListener<never>);
    return () => this.off(event, listener);
  }

  once<K extends keyof Events>(event: K, listener: EventListener<Events[K]>): () => void {
    const off = this.on(event, ((...args: Events[K]) => {
      off();
      listener(...args);
    }) as EventListener<Events[K]>);
    return off;
  }

  off<K extends keyof Events>(event: K, listener: EventListener<Events[K]>): void {
    const set = this.listeners.get(event);
    if (!set) return;
    set.delete(listener as EventListener<never>);
    if (set.size === 0) this.listeners.delete(event);
  }

  listenerCount<K extends keyof Events>(event: K): number {
    return this.listeners.get(event)?.size ?? 0;
  }

  /**
   * Calls every listener. A throwing listener does not prevent the others from
   * running, nor does it make the emitter fail; the error is re-thrown
   * asynchronously (like DOM `EventTarget`) so it still surfaces as unhandled.
   */
  emit<K extends keyof Events>(event: K, ...args: Events[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const listener of [...set]) {
      try {
        (listener as EventListener<Events[K]>)(...args);
      } catch (error) {
        queueMicrotask(() => {
          throw error;
        });
      }
    }
  }
}
