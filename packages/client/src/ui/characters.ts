// The character screen: pick one of the account's characters or create a new
// one. It appears right after the login and disappears once the world loads.

import {
  CLASSES,
  CLASS_KEYS,
  SEXES,
  SEX_NAMES,
  type ClassKey,
  type CharacterSummary,
  type Sex,
  type ChannelInfo,
} from '@lumiis/shared';
import { lookOptions } from '../art';

const mustFind = (id: string): HTMLElement => {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`missing element #${id}`);
  return element;
};

export type CharacterScreen = {
  show(list: CharacterSummary[], max: number): void;
  hide(): void;
  showError(text: string): void;
  /** Channels of one character, for the picker after a click on his row. */
  showChannels(characterId: number, list: ChannelInfo[]): void;
  hideChannels(): void;
};

export function createCharacterScreen(
  /** A row was clicked: ask for his channels. */
  onPick: (id: number) => void,
  /** A channel was chosen: enter the world there. */
  onSelect: (id: number, channel: number) => void,
  onCreate: (name: string, cls: ClassKey, sex: Sex, hair: string) => void,
): CharacterScreen {
  const overlay = mustFind('characters');
  const list = mustFind('character-list');
  const nameInput = mustFind('character-name') as HTMLInputElement;
  const error = mustFind('character-error');
  const createButton = mustFind('character-create') as HTMLButtonElement;
  const picker = mustFind('channel-picker');
  const classSelect = mustFind('character-class') as HTMLSelectElement;
  const sexSelect = mustFind('character-sex') as HTMLSelectElement;
  const hairSelect = mustFind('character-hair') as HTMLSelectElement;
  let lookFilled = false;

  /** Classes are fixed data; the hairstyles come from the style pack. */
  const fillLooks = (): void => {
    if (lookFilled) return;
    lookFilled = true;
    for (const key of CLASS_KEYS) classSelect.append(new Option(CLASSES[key].name, key));
    for (const sex of SEXES) sexSelect.append(new Option(SEX_NAMES[sex], sex));
    refreshHairs();
  };

  /** Only the hairstyles of this class and sex; any body may borrow none. */
  const refreshHairs = (): void => {
    const prefix = `${classSelect.value}_${sexSelect.value}_`;
    const { hairs } = lookOptions();
    const matching = hairs.filter((part) => part.id.startsWith(prefix));
    const list = matching.length > 0 ? matching : hairs;
    const previous = hairSelect.value;
    hairSelect.textContent = '';
    for (const part of list) hairSelect.append(new Option(part.name, part.id));
    if (list.some((part) => part.id === previous)) hairSelect.value = previous;
  };

  const pairHair = (): void => {
    refreshHairs();
    const match = [...hairSelect.options].find((option) =>
      option.value.startsWith(`${classSelect.value}_${sexSelect.value}_`),
    );
    if (match !== undefined) hairSelect.value = match.value;
  };

  classSelect.addEventListener('change', pairHair);
  sexSelect.addEventListener('change', pairHair);

  let shownList = '';
  let shownError = '';
  let shownChannels = '';

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
    onCreate(
      name,
      classSelect.value as ClassKey,
      sexSelect.value as Sex,
      hairSelect.value,
    );
  };

  createButton.addEventListener('click', submit);
  nameInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') submit();
  });

  return {
    show(next: CharacterSummary[], max: number): void {
      fillLooks();
      const signature = `${max}|${next.map((entry) => `${entry.id}:${entry.name}:${entry.level}`).join('|')}`;
      if (signature === shownList) return;
      shownList = signature;

      list.replaceChildren();
      for (const character of next) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'character-row';
        button.textContent = `${character.name} — level ${character.level}`;
        button.addEventListener('click', () => onPick(character.id));
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
      shownChannels = '';
      error.textContent = '';
      picker.classList.add('hidden');
      picker.replaceChildren();
      overlay.classList.add('hidden');
    },
    showChannels(characterId: number, channels: ChannelInfo[]): void {
      // One channel means no choice to make: walk straight in.
      if (channels.length <= 1) {
        onSelect(characterId, channels[0]?.channel ?? 1);
        return;
      }

      const signature = `${characterId}|${channels.map((entry) => `${entry.channel}:${entry.players}`).join('|')}`;
      if (signature === shownChannels) return;
      shownChannels = signature;

      picker.replaceChildren();

      const title = document.createElement('div');
      title.className = 'channel-picker-title';
      title.textContent = 'Choose a channel';
      picker.append(title);

      for (const entry of channels) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'character-row';
        button.textContent = `CH${entry.channel} — ${entry.players} ${entry.players === 1 ? 'player' : 'players'}`;
        button.addEventListener('click', () => {
          shownChannels = '';
          picker.classList.add('hidden');
          onSelect(characterId, entry.channel);
        });
        picker.append(button);
      }

      picker.classList.remove('hidden');
    },
    hideChannels(): void {
      if (shownChannels === '') return;
      shownChannels = '';
      picker.classList.add('hidden');
      picker.replaceChildren();
    },
    showError(text: string): void {
      if (text === shownError) return;
      shownError = text;
      error.textContent = text;
    },
  };
}
