import type { DragEvent } from 'react';

interface RemovableDropZoneProps {
  /** Called with a card id when a chip is dropped here (drag-to-remove). */
  onRemoveCard: (cardId: string) => void;
  /** Called when the zone itself is clicked/activated (clear the whole selection). */
  onClear: () => void;
}

/**
 * The drop target for drag-to-remove, and a contextual "clear all" control.
 *
 * Drag a selected-card chip onto it to remove just that card; click it (or focus
 * + Enter/Space) to clear the entire selection. Drag highlighting is toggled via
 * the element's class so no React state is needed in the host screen.
 */
export function RemovableDropZone({ onRemoveCard, onClear }: RemovableDropZoneProps) {
  const onDragOver = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  };
  const onDragEnter = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    event.currentTarget.classList.add('is-dragover');
  };
  const onDragLeave = (event: DragEvent<HTMLDivElement>): void => {
    event.currentTarget.classList.remove('is-dragover');
  };
  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    event.currentTarget.classList.remove('is-dragover');
    const cardId = event.dataTransfer.getData('text/plain');
    if (cardId) onRemoveCard(cardId);
  };

  return (
    <div
      className="selection__trash"
      role="button"
      tabIndex={0}
      aria-label="Drop a card here to remove it, or activate to clear the selection"
      onClick={onClear}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClear();
        }
      }}
      onDragOver={onDragOver}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <span className="selection__trash-icon" aria-hidden="true">
        🗑
      </span>
      <span>Drop a card here to remove it · click to clear all</span>
    </div>
  );
}
