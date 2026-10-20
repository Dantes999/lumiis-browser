// The login box: name and password, then either log in or create the account.
// It stays in front until the server welcomes us.

const mustFind = (id: string): HTMLElement => {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`missing element #${id}`);
  return element;
};

const NAME_STORAGE_KEY = 'lumiis.name';

export type LoginMode = 'login' | 'register';

export type Login = {
  showError(text: string): void;
  hide(): void;
};

export function createLogin(
  onSubmit: (name: string, password: string, mode: LoginMode) => void,
): Login {
  const overlay = mustFind('login');
  const nameInput = mustFind('login-name') as HTMLInputElement;
  const passwordInput = mustFind('login-password') as HTMLInputElement;
  const error = mustFind('login-error');
  const loginButton = mustFind('login-submit') as HTMLButtonElement;
  const registerButton = mustFind('login-register') as HTMLButtonElement;

  const remembered = window.localStorage.getItem(NAME_STORAGE_KEY);
  if (remembered !== null) nameInput.value = remembered;
  (nameInput.value === '' ? nameInput : passwordInput).focus();

  let shownError = '';

  const submit = (mode: LoginMode): void => {
    const name = nameInput.value.trim();
    const password = passwordInput.value;

    if (name === '' || password === '') {
      error.textContent = 'Name and password are required.';
      shownError = error.textContent;
      return;
    }

    shownError = '';
    error.textContent = '';
    window.localStorage.setItem(NAME_STORAGE_KEY, name);
    onSubmit(name, password, mode);
  };

  loginButton.addEventListener('click', () => submit('login'));
  registerButton.addEventListener('click', () => submit('register'));
  passwordInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') submit('login');
  });

  return {
    showError(text: string): void {
      if (text === shownError) return;
      shownError = text;
      error.textContent = text;
    },
    hide(): void {
      shownError = '';
      passwordInput.value = '';
      overlay.classList.add('hidden');
    },
  };
}
