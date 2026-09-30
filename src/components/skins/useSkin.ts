/**
 * Read the active interface skin inside React, hydration-safely.
 *
 * SSR and the first client render always report the default skin, so markup
 * matches; the persisted skin is applied in an effect. Also observes the
 * `data-skin` attribute so switching skins re-renders structural layouts.
 */

import { useEffect, useState } from "react";
import { DEFAULT_SKIN, SKINS, type SkinId } from "./skin";

export function useSkin(): SkinId {
  const [skin, setSkin] = useState<SkinId>(DEFAULT_SKIN);

  useEffect(() => {
    if (typeof MutationObserver === "undefined") return;
    const root = document.documentElement;
    const syncSkin = () => {
      const value = root.getAttribute("data-skin");
      setSkin(SKINS.find((skin) => skin.id === value)?.id ?? DEFAULT_SKIN);
    };
    syncSkin();
    const observer = new MutationObserver(syncSkin);
    observer.observe(root, { attributes: true, attributeFilter: ["data-skin"] });
    return () => observer.disconnect();
  }, []);

  return skin;
}
