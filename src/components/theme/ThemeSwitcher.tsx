"use client";

import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";
import { cn } from "@/lib/utils";

type Theme = "light" | "dark";

function readTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  const stored = window.localStorage.getItem("pulse-theme");
  return stored === "light" ? "light" : "dark";
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "dark") root.classList.add("dark");
  else root.classList.remove("dark");
  window.localStorage.setItem("pulse-theme", theme);
}

export function ThemeSwitcher() {
  const [theme, setTheme] = useState<Theme>("dark");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setTheme(readTheme());
    setMounted(true);
  }, []);

  function select(next: Theme) {
    setTheme(next);
    applyTheme(next);
  }

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="inline-flex p-1 rounded-full border border-white-200 bg-white-50 dark:bg-card dark:border-border"
    >
      {(
        [
          { id: "light" as const, label: "Light", Icon: Sun },
          { id: "dark" as const, label: "Dark", Icon: Moon },
        ]
      ).map(({ id, label, Icon }) => {
        const active = mounted && theme === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => select(id)}
            className={cn(
              "inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-sm cursor-pointer transition-colors duration-200",
              "[font-family:'Satoshi-500',var(--font-sans)]",
              active
                ? "bg-primary-500 text-white"
                : "text-gray-1000 hover:text-gray-1200 dark:text-text-muted dark:hover:text-foreground"
            )}
          >
            <Icon size={13} />
            {label}
          </button>
        );
      })}
    </div>
  );
}
