// The in-game log window: connection events, errors and anything else that is
// logged, readable without opening the browser's dev tools.
//
// It exists because "the client froze on the other PC" needs evidence, and a
// console nobody opened is no evidence at all.

import { logEntries, logText, onLog, type LogEntry } from '../log';

const MAX_SHOWN = 200;

const mustFind = (id: string): HTMLElement => {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`missing element #${id}`);
  return element;
};

const label = (entry: LogEntry): string => {
  const time = new Date(entry.at).toLocaleTimeString();
  return `[${time}] ${entry.level.toUpperCase()}: ${entry.text}`;
};

export function createLogPanel(): void {
  const panel = mustFind('log');
  const toggleButton = mustFind('log-toggle');
  const copyButton = mustFind('log-copy');
  const closeButton = mustFind('log-close');
  const lines = mustFind('log-lines');

  const render = (): void => {
    const all = logEntries().slice(-MAX_SHOWN);
    lines.textContent = all.map(label).join('\n');
    lines.scrollTop = lines.scrollHeight;
  };

  const toggle = (): void => {
    if (panel.classList.contains('hidden')) mustFind('bag').classList.add('hidden');
    panel.classList.toggle('hidden');
    render();
  };

  toggleButton.addEventListener('click', toggle);
  closeButton.addEventListener('click', () => panel.classList.add('hidden'));

  copyButton.addEventListener('click', () => {
    void navigator.clipboard?.writeText(logText()).then(
      () => {
        copyButton.textContent = 'Copied';
        window.setTimeout(() => {
          copyButton.textContent = 'Copy';
        }, 1200);
      },
      () => {
        copyButton.textContent = 'No access';
      },
    );
  });

  window.addEventListener('keydown', (event) => {
    if (event.code !== 'KeyL') return;
    event.preventDefault();
    toggle();
  });

  onLog(() => {
    if (!panel.classList.contains('hidden')) render();
  });

  render();
}
