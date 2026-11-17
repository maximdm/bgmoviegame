/**
 * Tiny external store around the pure game engine.
 *
 * `useSyncExternalStore` keeps React and Pixi in sync with one immutable
 * `GameState`. The store is deliberately small; server/AI controllers can be
 * layered on top later without changing the engine.
 */
import { applyAction } from '@movie-game/shared';
import type { Action, ActionResult, GameState } from '@movie-game/shared';
import { useSyncExternalStore } from 'react';

export class GameStore {
  private state: GameState;
  private readonly listeners = new Set<() => void>();

  constructor(initial: GameState) {
    this.state = initial;
  }

  readonly getState = (): GameState => this.state;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly dispatch = (action: Action): ActionResult => {
    const result = applyAction(this.state, action);
    if (result.ok) {
      this.state = result.state;
      this.emit();
    }
    return result;
  };

  readonly replace = (state: GameState): void => {
    this.state = state;
    this.emit();
  };

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

/** Read the current engine state from a store. */
export function useGameState(store: GameStore): GameState {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}
