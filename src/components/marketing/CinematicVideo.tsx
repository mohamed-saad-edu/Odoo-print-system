"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

interface CinematicVideoProps {
  mp4Src: string;
  title: string;
  lazy?: boolean;
  className?: string;
  posterSrc?: string;
}

function subscribeReducedMotion(callback: () => void) {
  if (typeof window === "undefined") return () => {};
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}

function getReducedMotionSnapshot() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function getServerSnapshot() {
  return false;
}

export function CinematicVideo({
  mp4Src,
  title,
  lazy = false,
  className = "",
  posterSrc,
}: CinematicVideoProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isAttached, setIsAttached] = useState(!lazy);
  const isReducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotionSnapshot,
    getServerSnapshot
  );

  useEffect(() => {
    if (isAttached) return;
    const container = containerRef.current;
    if (!container || !("IntersectionObserver" in window)) {
      setIsAttached(true);
      return;
    }

    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setIsAttached(true);
        observer.disconnect();
      }
    }, { rootMargin: "300px 0px" });

    observer.observe(container);
    return () => observer.disconnect();
  }, [isAttached]);

  useEffect(() => {
    const video = videoRef.current;
    const container = containerRef.current;
    if (!video || !container || !isAttached) return;

    let inViewport = false;
    const play = () => {
      if (!isReducedMotion && !document.hidden && inViewport) {
        void video.play().catch(() => {});
      }
    };
    const pause = () => video.pause();
    const onVisibilityChange = () => document.hidden ? pause() : play();

    if ("IntersectionObserver" in window) {
      const observer = new IntersectionObserver(([entry]) => {
        inViewport = entry.isIntersecting && entry.intersectionRatio >= 0.25;
        if (inViewport) play();
        else pause();
      }, { threshold: [0, 0.25, 0.5] });
      observer.observe(container);

      document.addEventListener("visibilitychange", onVisibilityChange);
      return () => {
        observer.disconnect();
        document.removeEventListener("visibilitychange", onVisibilityChange);
        pause();
      };
    }

    inViewport = true;
    play();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      pause();
    };
  }, [isAttached, isReducedMotion]);

  return (
    <div
      ref={containerRef}
      role="group"
      aria-label={title}
      className={`yw-cinematic-frame relative aspect-video w-full overflow-hidden rounded-2xl border border-edge/80 bg-black md:rounded-3xl ${className}`}
    >
      {isAttached && (
        <video
          ref={videoRef}
          muted
          playsInline
          loop
          poster={posterSrc}
          preload={lazy ? "none" : "metadata"}
          title={title}
          className="absolute inset-0 h-full w-full object-contain"
        >
          <source src={mp4Src} type="video/mp4" />
        </video>
      )}
    </div>
  );
}
