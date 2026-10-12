"use client";

import { useSyncExternalStore } from "react";
import { useLocale } from "@/messages/client";
import { relativeTime } from "@/lib/relative-time";

// One shared clock for every RelativeTime on the page: null on the server and during hydration, then a timestamp
// that is refreshed once a minute so "5 minutes ago" does not go stale on a page left open.
let clock: number | null = null;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

function subscribe(listener: () => void) {
  listeners.add(listener);
  clock = Date.now();
  timer ??= setInterval(() => {
    clock = Date.now();
    listeners.forEach((l) => l());
  }, 60_000);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}
const getClock = () => clock;
const getServerClock = () => null;

const EXACT = {
  vi: new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
  en: new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
};

/**
 * "2 days ago" in a time element (dateTime = the ISO value) whose title is the exact time in Asia/Ho_Chi_Minh.
 * The server and the first client render both show the exact time, so the markup matches and there is no
 * hydration warning; right after mount the shared clock supplies "now" and the relative text replaces it.
 */
export function RelativeTime({ iso }: { iso: string }) {
  const locale = useLocale();
  const now = useSyncExternalStore(subscribe, getClock, getServerClock);
  const date = new Date(iso);
  const exact = Number.isNaN(date.getTime()) ? iso : EXACT[locale].format(date);
  return (
    <time dateTime={iso} title={exact}>
      {now === null ? exact : relativeTime(iso, new Date(now), locale)}
    </time>
  );
}
