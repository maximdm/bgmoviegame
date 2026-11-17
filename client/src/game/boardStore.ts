/**
 * External store around the board-game engine variant. Mirrors `store.ts` but
 * for `BoardState` / `BoardAction` so the two variants stay independent.
 */
import {
  applyBoardAction,
  type BoardAction,
  type BoardActionResult,
  type BoardState,
} from '@movie-game/shared';
import { useSyncExternalStore } from 'react';

export class BoardStore {
  private state: BoardState;
  private readonly listeners = new Set<() => void>();

  constructor(initial: BoardState) {
    this.state = initial;
  }

  readonly getState = (): BoardState => this.state;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly dispatch = (action: BoardAction): BoardActionResult => {
    const result = applyBoardAction(this.state, action);
    if (result.ok) {
      this.state = result.state;
      this.emit();
    }
    return result;
  };

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

export function useBoardState(store: BoardStore): BoardState {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}
