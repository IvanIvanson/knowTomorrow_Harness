import { api, ApiError } from './api.js';
import { trackEvent } from './metrics.js';
import {
  detectPlatform,
  isStandalone,
  platformLabel,
  scrollToElement,
  setButtonLoading,
  toast
} from './ui.js';

let deferredPrompt = null;

function setInstallState(installed) {
  const buttons = [document.getElementById('installBtn'), document.getElementById('heroInstall')];
  buttons.forEach((button) => {
    if (!button) return;
    if (installed) {
      button.disabled = true;
      button.textContent = 'Приложение установлено';
    }
  });
  const hint = document.getElementById('installHint');
  if (hint && installed) hint.textContent = 'KnowTomorrow уже открывается как отдельное приложение.';
}

function initHeader() {
  const header = document.querySelector('.site-header');
  const toggle = document.getElementById('navToggle');
  const nav = document.getElementById('siteNav');
  if (header) {
    const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }
  if (toggle && nav) {
    const backdrop = document.getElementById('siteNavBackdrop');
    const setOpen = (open) => {
      nav.classList.toggle('is-open', open);
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
      toggle.innerHTML = `<svg class="icon" aria-hidden="true"><use href="#i-${open ? 'close' : 'menu'}"></use></svg>`;
      document.body.classList.toggle('menu-open', open);
      if (backdrop) backdrop.hidden = !open;
    };

    toggle.addEventListener('click', () => setOpen(!nav.classList.contains('is-open')));
    backdrop?.addEventListener('click', () => setOpen(false));
    nav.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => setOpen(false));
    });
    document.querySelectorAll('.header-actions a, .header-inner > .brand').forEach((link) => {
      link.addEventListener('click', () => setOpen(false));
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && nav.classList.contains('is-open')) setOpen(false);
    });
    window.addEventListener('resize', () => {
      if (window.innerWidth > 960 && nav.classList.contains('is-open')) setOpen(false);
    });
  }
}

function initReveal() {
  const elements = document.querySelectorAll('.reveal');
  if (!('IntersectionObserver' in window)) {
    elements.forEach((element) => element.classList.add('is-visible'));
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.08 }
  );
  elements.forEach((element) => observer.observe(element));

  // Страховка: контент не должен оставаться невидимым, если наблюдатель
  // не сработал (полная страница, печать, необычный браузер).
  window.setTimeout(() => {
    elements.forEach((element) => element.classList.add('is-visible'));
  }, 2200);
}

function initInstall() {
  if (isStandalone()) setInstallState(true);

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    const hint = document.getElementById('installHint');
    if (hint) hint.textContent = 'Браузер готов установить приложение — нажмите кнопку.';
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    setInstallState(true);
    trackEvent('install', 'pwa');
    toast('KnowTomorrow установлен. Откройте иконку на рабочем столе.', 'success');
  });

  const install = async () => {
    if (deferredPrompt) {
      const prompt = deferredPrompt;
      deferredPrompt = null;
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === 'accepted') {
        toast('Установка началась', 'success');
      }
      return;
    }
    const downloads = document.getElementById('downloads');
    scrollToElement(downloads, 76);
    toast(
      'Если браузер не предложил установку, откройте меню и выберите «Установить приложение» или «На экран Домой».',
      'info',
      6500
    );
  };

  document.getElementById('installBtn')?.addEventListener('click', install);
  document.getElementById('heroInstall')?.addEventListener('click', install);
}

function initPlatform() {  const platform = detectPlatform();
  const badge = document.getElementById('platformBadge');
  if (badge) badge.textContent = `Вы открыли: ${platformLabel(platform)}`;
  document.querySelectorAll('[data-platform]').forEach((card) => {
    if (card.dataset.platform === platform) {
      card.classList.add('is-current');
      const label = document.createElement('span');
      label.className = 'badge badge--teal download-current';
      label.textContent = 'ваша система';
      card.prepend(label);
    }
  });
  if (platform === 'ios') {
    const hint = document.getElementById('installHint');
    if (hint) {
      hint.textContent =
        'На iPhone: откройте сайт в Safari → «Поделиться» → «На экран Домой».';
    }
  }
}

async function initStats() {
  try {
    const stats = await api.stats();
    const element = document.getElementById('heroSocialText');
    if (!element) return;
    if (stats.users >= 5) {
      const entries = Number(stats.entries || 0);
      element.textContent = `${stats.users} участников · ${entries.toLocaleString('ru-RU')} записей`;
    } else if (stats.users > 0) {
      element.textContent = `Идёт набор первых участников · уже ${stats.users}`;
    }
  } catch {
    // Сервер может быть недоступен — это не мешает лендингу.
  }
}

function initAuth() {
  const tabs = document.querySelectorAll('[data-auth-tab]');
  const panels = {
    login: document.getElementById('loginPanel'),
    register: document.getElementById('registerPanel')
  };
  const tabButtons = {
    login: document.getElementById('tabLogin'),
    register: document.getElementById('tabRegister')
  };

  function activate(name) {
    Object.entries(panels).forEach(([key, panel]) => {
      panel?.classList.toggle('hidden', key !== name);
    });
    Object.entries(tabButtons).forEach(([key, button]) => {
      if (!button) return;
      const active = key === name;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
    });
    document.querySelectorAll('.form-error').forEach((error) => {
      error.classList.remove('is-visible');
      error.textContent = '';
    });
    const firstInput = panels[name]?.querySelector('input');
    if (firstInput && name === 'register') window.setTimeout(() => firstInput.focus(), 60);
  }

  tabs.forEach((tab) => {
    tab.addEventListener('click', (event) => {
      event.preventDefault();
      activate(tab.dataset.authTab);
    });
  });

  // Кнопки «Попробовать KnowTomorrow» ведут к форме и сразу открывают регистрацию.
  document.querySelectorAll('[data-auth-cta]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      activate(button.dataset.authCta || 'register');
      const card = document.getElementById('authCard');
      scrollToElement(card, 84);
      window.setTimeout(() => {
        const target = button.dataset.authCta === 'login' ? 'loginEmail' : 'registerName';
        document.getElementById(target)?.focus({ preventScroll: true });
      }, 450);
    });
  });

  const params = new URLSearchParams(window.location.search);
  const requested = params.get('auth');
  if (requested === 'register' || requested === 'login') {
    activate(requested);
    window.setTimeout(() => scrollToElement(document.getElementById('authCard'), 84), 120);
  }

  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');
  const loginError = document.getElementById('loginError');
  const registerError = document.getElementById('registerError');

  function showError(element, message) {
    if (!element) return;
    element.textContent = message;
    element.classList.add('is-visible');
  }

  loginForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    loginError.classList.remove('is-visible');
    const email = loginForm.email.value.trim();
    const password = loginForm.password.value;
    if (!email || !password) {
      showError(loginError, 'Введите email и пароль.');
      return;
    }
    const button = document.getElementById('loginSubmit');
    setButtonLoading(button, true, 'Входим…');
    try {
      await api.login(email, password);
      toast('Вход выполнен. Открываем приложение…', 'success');
      window.setTimeout(() => {
        window.location.href = '/app';
      }, 350);
    } catch (error) {
      showError(loginError, error instanceof ApiError ? error.message : 'Не удалось войти.');
      setButtonLoading(button, false);
    }
  });

  registerForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    registerError.classList.remove('is-visible');
    const name = registerForm.name.value.trim();
    const email = registerForm.email.value.trim();
    const password = registerForm.password.value;
    const terms = document.getElementById('registerTerms').checked;
    const research = document.getElementById('registerResearch').checked;

    if (!email || !password) {
      showError(registerError, 'Введите email и пароль.');
      return;
    }
    if (password.length < 8) {
      showError(registerError, 'Пароль должен быть не короче 8 символов.');
      return;
    }
    if (!terms) {
      showError(registerError, 'Нужно принять условия использования и политику конфиденциальности.');
      return;
    }
    const button = document.getElementById('registerSubmit');
    setButtonLoading(button, true, 'Создаём аккаунт…');
    try {
      await api.register({
        name,
        email,
        password,
        acceptTerms: true,
        consentResearch: research
      });
      toast('Аккаунт создан. Добро пожаловать!', 'success');
      window.setTimeout(() => {
        window.location.href = '/app?onboarding=1';
      }, 350);
    } catch (error) {
      showError(registerError, error instanceof ApiError ? error.message : 'Не удалось создать аккаунт.');
      setButtonLoading(button, false);
    }
  });
}

function initFaq() {
  document.querySelectorAll('.faq details').forEach((details) => {
    details.addEventListener('toggle', () => {
      if (!details.open) return;
      document.querySelectorAll('.faq details').forEach((other) => {
        if (other !== details) other.open = false;
      });
    });
  });
}

function initDownloadTracking() {
  document.querySelectorAll('[data-download]').forEach((element) => {
    element.addEventListener('click', () => {
      trackEvent('download', element.dataset.download);
    });
  });
}

function initYear() {
  const year = document.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());
}

initHeader();
initReveal();
initInstall();
initDownloadTracking();
initPlatform();
initStats();
initAuth();
initFaq();
initYear();
trackEvent('view', 'landing');
