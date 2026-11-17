/**
 * External store around the dice-variant engine. Mirrors `boardStore.ts` but
 * for `DiceState` / `DiceAction` so the three variants stay independent.
 */
import {
  applyDiceAction,
  type DiceAction,
  type DiceActionResult,
  type DiceState,
} from '@movie-game/shared';
import { useSyncExternalStore } from 'react';

export class DiceStore {
  private state: DiceState;
  private readonly listeners = new Set<() => void>();

  constructor(initial: DiceState) {
    this.state = initial;
  }

  readonly getState = (): DiceState => this.state;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly dispatch = (action: DiceAction): DiceActionResult => {
    const result = applyDiceAction(this.state, action);
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

export function useDiceState(store: DiceStore): DiceState {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}
