"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import * as Dialog from "@radix-ui/react-dialog";
import { Menu, X } from "lucide-react";
import { LanguageSwitcher } from "../LanguageSwitcher";
import { ThemeToggle } from "../ThemeToggle";

type NavEntry = { href: string; label: string };

export function MobileNavigation({
  items,
  menuLabel,
  closeLabel,
  languageLabel,
}: {
  items: NavEntry[];
  menuLabel: string;
  closeLabel: string;
  languageLabel: string;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const media = window.matchMedia("(min-width: 1280px)");
    const closeMenu = () => setOpen(false);
    const onMedia = (e: MediaQueryListEvent) => {
      if (e.matches) closeMenu();
    };
    media.addEventListener("change", onMedia);
    window.addEventListener("scroll", closeMenu, { passive: true, once: true });
    window.addEventListener("yaseir:locale-navigation", closeMenu);
    return () => {
      media.removeEventListener("change", onMedia);
      window.removeEventListener("scroll", closeMenu);
      window.removeEventListener("yaseir:locale-navigation", closeMenu);
    };
  }, [open]);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen} modal={false}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          aria-label={menuLabel}
          className="yw-mobile-nav-trigger inline-flex h-10 w-10 items-center justify-center rounded-md border border-edge bg-surface text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand xl:hidden"
        >
          <Menu className="h-5 w-5" aria-hidden="true" />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Content
          aria-describedby={undefined}
          className="yw-nav-panel fixed end-3 top-[calc(56px+env(safe-area-inset-top)+8px)] z-[91] w-[min(292px,calc(100vw-24px))] overflow-y-auto rounded-xl border border-edge bg-surface p-4 text-ink shadow-xl outline-none lg:top-[calc(64px+env(safe-area-inset-top)+8px)] xl:hidden"
        >
          <div className="flex items-center justify-between gap-3 border-b border-edge pb-3">
            <Dialog.Title className="text-sm font-semibold text-ink">{menuLabel}</Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label={closeLabel}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md text-ink-2 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </Dialog.Close>
          </div>
          <nav aria-label={menuLabel} className="py-2">
            <ul className="space-y-1">
              {items.map(({ href, label }) => (
                <li key={href}>
                  <Dialog.Close asChild>
                    {href.startsWith("#")
                      ? <a href={href} className="yw-mobile-nav-link">{label}</a>
                      : <Link href={href} className="yw-mobile-nav-link">{label}</Link>}
                  </Dialog.Close>
                </li>
              ))}
            </ul>
          </nav>
          <div className="flex min-h-11 items-center justify-between border-t border-edge pt-2">
            <span className="text-sm text-ink-2">{languageLabel}</span>
            <div className="flex items-center gap-2">
              <LanguageSwitcher compact />
              <ThemeToggle />
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
