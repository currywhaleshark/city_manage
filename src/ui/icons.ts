export function icon(name: string, size = 20) {
  const paths: Record<string, string> = {
    city: '<path d="M3 21V9h6v12M9 21V3h7v18M16 21v-9h5v9M1 21h22M5 12h1m-1 4h1m6-9h1m-1 4h1m-1 4h1m6 1h1"/>',
    play: '<path d="m9 5 11 7-11 7z"/>',
    pause: '<path d="M8 5v14M16 5v14"/>',
    reset: '<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/>',
    signal:
      '<rect x="8" y="2" width="8" height="17" rx="3"/><path d="M12 19v3"/><circle cx="12" cy="6" r="1"/><circle cx="12" cy="10.5" r="1"/><circle cx="12" cy="15" r="1"/>',
    bypass: '<path d="M3 19h5V5h8v14h5M1 16l3 3-3 3M18 16l3 3-3 3"/>',
    oneWay: '<path d="M3 8h17m-5-5 5 5-5 5M3 17h12m-4-4 4 4-4 4"/>',
    car: '<path d="m5 6-2 7v6h3v-3h12v3h3v-6l-2-7zM3 12h18M6 15h2m8 0h2"/>',
    coin: '<circle cx="12" cy="12" r="9"/><path d="M9 8h6m-6 4h6m-6 4h6M12 6v12"/>',
    eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    layers: '<path d="m2 8 10-5 10 5-10 5zm0 5 10 5 10-5M2 18l10 5 10-5"/>',
    home: '<path d="m3 10 9-7 9 7M5 9v12h14V9M10 21v-7h4v7"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
    chart: '<path d="M4 3v17h17M8 15l4-5 4 3 5-7"/>',
    sound:
      '<path d="M4 9h4l5-4v14l-5-4H4zM17 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4M12 17h.01"/>',
  };
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? paths.city}</svg>`;
}
