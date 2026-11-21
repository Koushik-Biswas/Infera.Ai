/**
 * Inline <head> scripts that must run before first paint / before React hydrates.
 *
 * Deliberately NOT a "use client" module: app/layout.tsx is a server component, and a value imported
 * from a client module arrives there as a client reference (a stub function), not as the string —
 * the page would then inline `function(){throw …}`, a SyntaxError, and neither script would run.
 */

/** localStorage key of the theme preference (light | dark | system). */
export const THEME_STORAGE_KEY = "infera-theme";

/** Applies the saved/system theme before paint, so there is never a light→dark flash. */
export const themeInitScript = `(function(){try{var k='${THEME_STORAGE_KEY}';var t=localStorage.getItem(k)||'system';var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);var r=document.documentElement;r.classList.toggle('dark',d);r.style.colorScheme=d?'dark':'light';}catch(e){}})();`;

/** Catches the install prompt even if it fires before React hydrates. */
export const installInitScript = `window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__bip=e;window.dispatchEvent(new Event('infera-bip'));});`;
