// The chat window: map chat, global chat and whispers.
//
// Enter opens it, Enter sends, Escape closes. Commands the server understands:
// `/g text` (global) and `/w Name text` (whisper). The scope picker simply
// prepends /g, so the input stays a plain text field.

import { view } from '../state';

const mustFind = (id: string): HTMLElement => {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`missing element #${id}`);
  return element;
};

/** A typing target should never be stolen by the game's key handlers. */
const isTyping = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  );
};

const MAX_SHOWN = 60;

export type ChatPanel = {
  toggle(): void;
  render(): void;
};

export function createChatPanel(onSend: (text: string) => void): ChatPanel {
  const panel = mustFind('chat');
  const toggleButton = mustFind('chat-toggle');
  const closeButton = mustFind('chat-close');
  const sendButton = mustFind('chat-send');
  const input = mustFind('chat-input') as HTMLInputElement;
  const scope = mustFind('chat-scope') as HTMLSelectElement;
  const lines = mustFind('chat-lines');

  const render = (): void => {
    const shown = view.chat.slice(-MAX_SHOWN);
    lines.textContent = '';
    for (const line of shown) {
      const row = document.createElement('div');
      row.className = `chat-line chat-${line.kind}`;
      const own = line.from === view.self.name;
      const who = own ? 'Du' : line.from;
      let prefix = '';
      if (line.kind === 'global') prefix = '[Global] ';
      if (line.kind === 'whisper') prefix = own ? `[Flüstern an ${line.to ?? '?'}] ` : '[Flüstern] ';
      row.textContent = line.kind === 'system' ? line.text : `${prefix}${who}: ${line.text}`;
      lines.append(row);
    }
    lines.scrollTop = lines.scrollHeight;
  };

  const close = (): void => panel.classList.add('hidden');

  const open = (): void => {
    mustFind('bag').classList.add('hidden');
    panel.classList.remove('hidden');
    render();
    input.focus();
  };

  const toggle = (): void => {
    if (panel.classList.contains('hidden')) open();
    else close();
  };

  const send = (): void => {
    const text = input.value.trim();
    if (text === '') return;
    input.value = '';
    const wantsGlobal = scope.value === 'global' && !text.startsWith('/');
    onSend(wantsGlobal ? `/g ${text}` : text);
    input.focus();
  };

  toggleButton.addEventListener('click', toggle);
  closeButton.addEventListener('click', close);
  sendButton.addEventListener('click', send);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      send();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  });

  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    if (isTyping(event.target)) return;
    if (event.repeat) return;
    if (panel.classList.contains('hidden')) {
      event.preventDefault();
      open();
    }
  });

  return { toggle, render };
}
