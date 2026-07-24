/**
 * Minimal, dependency-free typed event bus used by the Workspace.
 */

export type EventMap = Record<string, unknown[]>;

export type EventListener<Args extends unknown[]> = (...args: Args) => void;

export class EventBus<Events extends EventMap> {
  private readonly listeners = new Map<keyof Events, Set<EventListener<never>>>();

  on<K extends keyof Events>(event: K, listener: EventListener<Events[K]>): () => void {
    const set = this.listeners.get(event) ?? new Set();
    set.add(listener as EventListener<never>);
    this.listeners.set(event, set);
    return () => this.off(event, listener);
  }

  off<K extends keyof Events>(event: K, listener: EventListener<Events[K]>): void {
    this.listeners.get(event)?.delete(listener as EventListener<never>);
  }

  emit<K extends keyof Events>(event: K, ...args: Events[K]): void {
    for (const listener of this.listeners.get(event) ?? []) {
      (listener as EventListener<Events[K]>)(...args);
    }
  }
}
