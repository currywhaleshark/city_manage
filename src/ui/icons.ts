export function icon(name: string, size = 20) {
  const paths: Record<string, string> = {
    water:
      '<path d="M3 7q3-4 6 0t6 0t6 0M3 13q3-4 6 0t6 0t6 0M3 19q3-4 6 0t6 0t6 0"/>',
    outlet:
      '<path d="M3 3h7v7h9v5h-9a5 5 0 0 1-5-5V3M18 17s-3 3-3 4a3 3 0 0 0 6 0c0-1-3-4-3-4Z"/>',
    sewer: '<path d="M2 21V9h20v12M5 9V3h5v6M14 9V3h5v6M6 14h12M6 18h12"/>',
    riverCleanup:
      '<path d="M2 18q3-3 6 0t6 0t6 0M3 12h18M6 8v8m6-8v8m6-8v8M16 3h5"/>',
    cleanup:
      '<path d="m15 2-4 9M8 10l7 3-3 8H3l2-9zM6 16l-1 5m4-4-1 4M16 15h6m-4 4h3"/>',
    dropoff: '<path d="M3 5h18M5 5v16h14V5M8 5V2h8v3M8 11h8M12 8v6"/>',
    outreach: '<path d="M3 10v5l5 1 11 5V3L8 8zM8 16l1 5h4l-2-4M22 8v8"/>',
    goods: '<path d="m3 7 9-4 9 4v13H3zM3 7l9 4 9-4M12 11v9M8 5l9 4v4"/>',
    cargoTruck:
      '<path d="M2 5h12v13H2zM14 9h4l4 5v4h-8M15 9v5h7"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="19" r="2"/>',
    handling: '<path d="M8 2h8v8H8zM12 2v4M2 13l5 5h10l5-5M6 22v-4m12 4v-4"/>',
    diversify:
      '<path d="M3 5h6l3 7 3-7h6M3 19h6l3-7 3 7h6M18 2l3 3-3 3m0 8 3 3-3 3"/>',
    shortcut: '<path d="M3 19V5h18v14M3 19l18-14M8 14l4 1-1-4"/>',
    waste: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
    residents:
      '<circle cx="8" cy="7" r="3"/><circle cx="17" cy="8" r="2.5"/><path d="M2 21v-5a6 6 0 0 1 12 0v5m1-9a5 5 0 0 1 7 5v4"/>',
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
    library:
      '<path d="M12 6v15M12 6C9 3 5 3 2 4v15c3-1 7-1 10 2 3-3 7-3 10-2V4c-3-1-7-1-10 2Z"/>',
    park: '<path d="m12 2-6 8h3l-5 7h16l-5-7h3zM12 17v5M7 22h10"/>',
    industry:
      '<path d="M3 21V10l6-4v6l6-4v13M15 21V3h4l2 18M1 21h22M6 16h1m4 0h1"/>',
    housing: '<path d="m2 10 7-6 7 6M4 9v12h10V9m2-5h5v17h-7M7 21v-7h4v7"/>',
    conserve:
      '<path d="M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6zM12 7v10m-4-7 4 4 4-4"/>',
    buffer: '<path d="m6 3-4 9h8zm12 0-4 9h8zM6 12v6m12-6v6M2 21h20"/>',
    small:
      '<path d="M3 3h6v6M21 21h-6v-6M9 9 2 2m13 13 7 7M3 15v6h6M15 3h6v6"/>',
    expand:
      '<path d="M3 21V6h10v15M1 21h22M17 6v8m-4-4h8M6 10h4m-4 4h4m-4 4h4"/>',
    gate: '<path d="M3 21V3h10v5M13 17v4H3M8 12h14m-4-4 4 4-4 4"/>',
    patrol:
      '<path d="m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6Z"/><path d="m8 12 3 3 5-6"/>',
    parkingLot:
      '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M9 18V7h4a3 3 0 0 1 0 6H9"/>',
    loadingBay:
      '<path d="M2 18h20M5 15V9l2-5h10l2 5v6M5 9h14M8 12h.01M16 12h.01M12 20v2"/>',
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
