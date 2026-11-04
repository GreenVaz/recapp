import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

type Theme = 'dark' | 'light' | 'system';

const STORAGE_KEY = 'pf-theme';

interface ThemeValue {
  theme: Theme;
  resolved: 'dark' | 'light';
  setTheme(theme: Theme): void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

function readStored(): Theme {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === 'dark' || value === 'light' || value === 'system') return value;
  } catch {
    // Приватний режим може заборонити доступ до сховища — не привід падати.
  }
  return 'dark';
}

function systemTheme(): 'dark' | 'light' {
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readStored);
  const [resolved, setResolved] = useState<'dark' | 'light'>(() =>
    readStored() === 'system' ? systemTheme() : (readStored() as 'dark' | 'light'),
  );

  useEffect(() => {
    const next = theme === 'system' ? systemTheme() : theme;
    setResolved(next);
    document.documentElement.dataset.theme = next;

    // Колір системної панелі має збігатися з фоном, інакше в standalone
    // згори лишається смуга чужого кольору.
    const meta = document.querySelector('meta[name="theme-color"]:not([media])');
    const color = next === 'dark' ? '#0b0d12' : '#f5f6f9';
    if (meta) meta.setAttribute('content', color);

    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // ignore
    }
  }, [theme]);

  useEffect(() => {
    if (theme !== 'system') return;
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => setThemeState('system');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => setThemeState(next), []);

  return (
    <ThemeContext.Provider value={{ theme, resolved, setTheme }}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme має викликатися всередині ThemeProvider');
  return value;
}
