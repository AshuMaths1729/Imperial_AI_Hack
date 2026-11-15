"use client";

import React, { useEffect, useSyncExternalStore } from "react";
import { Contrast, Moon, Sun } from "lucide-react";
import { Segmented } from "./glass/Segmented";

export type ThemeMode = "light" | "dark" | "contrast";

const THEME_STORAGE_KEY = "scholartwin.theme.v2";
const listeners = new Set<() => void>();

function subscribeTheme(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === THEME_STORAGE_KEY) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

function getThemeSnapshot(): ThemeMode {
  if (typeof window === "undefined") return "light";
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === "light" || saved === "dark" || saved === "contrast") return saved;
  } catch {
    // ignore storage access errors
  }
  return "light";
}

function getServerThemeSnapshot(): ThemeMode {
  return "light";
}

export function setThemeMode(next: ThemeMode) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // ignore storage errors
  }
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = next;
  }
  listeners.forEach((cb) => cb());
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribeTheme, getThemeSnapshot, getServerThemeSnapshot);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const toggleTheme = () =>
    setThemeMode(theme === "light" ? "dark" : theme === "dark" ? "contrast" : "light");
  return { theme, setTheme: setThemeMode, toggleTheme };
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  return <>{children}</>;
}

const THEME_OPTIONS: {
  id: ThemeMode;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
  { id: "contrast", label: "High Contrast", icon: Contrast },
];

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <Segmented
      label="Color theme"
      value={theme}
      onChange={setTheme}
      buttonClassName="px-2 py-1 text-[11px] sm:px-2.5"
      options={THEME_OPTIONS.map((opt) => {
        const Icon = opt.icon;
        return {
          value: opt.id,
          ariaLabel: `${opt.label} theme`,
          title: `${opt.label} theme`,
          label: (
            <>
              <Icon className={`h-3.5 w-3.5 ${theme === opt.id ? "text-[var(--accent)]" : ""}`} />
              {/* Labels only on wide screens so crowded headers don't overflow at 768-1279px */}
              <span className="hidden whitespace-nowrap xl:inline">{opt.label}</span>
            </>
          ),
        };
      })}
    />
  );
}
