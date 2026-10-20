// The character screen: pick one of the account's characters or create a new
// one. It appears right after the login and disappears once the world loads.

import type { CharacterSummary } from '@lumiis/shared';

const mustFind = (id: string): HTMLElement => {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`missing element #${id}`);
  return element;
};

export type CharacterScreen = {
  show(list: CharacterSummary[], max: number): void;
  hide(): void;
  showError(text: string): void;
};

export function createCharacterScreen(
  onSelect: (id: number) => void,
  onCreate: (name: string) => void,
): CharacterScreen {
  const overlay = mustFind('characters');
  const list = mustFind('character-list');
  const nameInput = mustFind('character-name') as HTMLInputElement;
  const error = mustFind('character-error');
  const createButton = mustFind('character-create') as HTMLButtonElement;

  let shownList = '';
  let shownError = '';

  const submit = (): void => {
    const name = nameInput.value.trim();
    if (name === '') {
      error.textContent = 'Please type a name.';
      shownError = error.textContent;
      return;
    }
    error.textContent = '';
    shownError = '';
    nameInput.value = '';
    onCreate(name);
  };

  createButton.addEventListener('click', submit);
  nameInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') submit();
  });

  return {
    show(next: CharacterSummary[], max: number): void {
      const signature = `${max}|${next.map((entry) => `${entry.id}:${entry.name}:${entry.level}`).join('|')}`;
      if (signature === shownList) return;
      shownList = signature;

      list.replaceChildren();
      for (const character of next) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'character-row';
        button.textContent = `${character.name} — level ${character.level}`;
        button.addEventListener('click', () => onSelect(character.id));
        list.append(button);
      }

      if (next.length === 0) {
        const hint = document.createElement('div');
        hint.className = 'character-empty';
        hint.textContent = 'No characters yet. Create one below.';
        list.append(hint);
      }

      createButton.disabled = next.length >= max;
      overlay.classList.remove('hidden');
    },
    hide(): void {
      shownList = '';
      shownError = '';
      error.textContent = '';
      overlay.classList.add('hidden');
    },
    showError(text: string): void {
      if (text === shownError) return;
      shownError = text;
      error.textContent = text;
    },
  };
}
