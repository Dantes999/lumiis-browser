// The channel chip in the HUD and the little list that switches channels.
// The login screen has its own picker (ui/characters.ts); this one is for
// changing channel while playing.

import type { ChannelInfo } from '@lumiis/shared';
import type { ViewState } from '../state';

const mustFind = (id: string): HTMLElement => {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`missing element #${id}`);
  return element;
};

export type ChannelUi = {
  render(view: ViewState): void;
};

export function createChannelUi(
  /** Called when the list opens, so the caller can ask the server for counts. */
  onOpen: () => void,
  onSwitch: (channel: number) => void,
): ChannelUi {
  const chip = mustFind('channel-button') as HTMLButtonElement;
  const pop = mustFind('channel-pop');
  const list = mustFind('channel-list');

  let open = false;
  let shown = '';

  const close = (): void => {
    open = false;
    pop.classList.add('hidden');
    shown = '';
  };

  const toggle = (): void => {
    open = !open;
    pop.classList.toggle('hidden', !open);
    shown = '';
    if (open) onOpen();
  };

  chip.addEventListener('click', toggle);

  const renderList = (entries: ChannelInfo[], current: number): void => {
    if (!open) return;

    const signature = `${current}|${entries.map((entry) => `${entry.channel}:${entry.players}`).join('|')}`;
    if (signature === shown) return;
    shown = signature;

    list.replaceChildren();
    for (const entry of entries) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = entry.channel === current ? 'channel-row current' : 'channel-row';
      button.textContent = `CH${entry.channel} — ${entry.players} ${entry.players === 1 ? 'player' : 'players'}`;
      button.disabled = entry.channel === current;
      button.addEventListener('click', () => {
        close();
        onSwitch(entry.channel);
      });
      list.append(button);
    }
  };

  return {
    render(view: ViewState): void {
      const count = view.channelCount;
      if (count <= 1) {
        chip.classList.add('hidden');
        if (open) close();
        return;
      }

      chip.classList.remove('hidden');
      const label = `CH${view.channel}/${count}`;
      if (chip.textContent !== label) chip.textContent = label;

      // The list arrives after the open request; the id is null in game.
      const options = view.channelOptions;
      if (options !== null && options.id === null) renderList(options.list, view.channel);
    },
  };
}
