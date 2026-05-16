"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type OverlayPortalProps = {
  children: React.ReactNode;
  /** When false, nothing is portaled (avoids SSR mismatch). */
  active?: boolean;
};

/** Renders children on document.body so fixed overlays escape parent stacking contexts. */
export function OverlayPortal({ children, active = true }: OverlayPortalProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || !active) return null;
  return createPortal(children, document.body);
}
