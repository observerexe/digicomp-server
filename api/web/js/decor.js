import { svgFromString } from './dom.js';

// Декоративні «доріжки» плати: лінії під кутами 45° і 90°, контактні площадки.
export function traces() {
  return svgFromString(`<svg class="traces" viewBox="0 0 800 420" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
    <g fill="none" stroke="#e9f3ec" stroke-opacity=".13" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M-10 90H140l40 40h170l30-30h140l50 50h110"/>
      <path d="M-10 210h90l40-40h120l60 60h210l40-40h160"/>
      <path d="M-10 320h200l50-50h110l50 50h180l60-60h160"/>
      <path d="M120 -10v70l40 40M470 -10v120l40 40v110M700 430V330l-40-40"/>
      <path d="M300 430V350l50-50M560 430v-70l40-40"/>
    </g>
    <g fill="#e9f3ec" fill-opacity=".2">
      <circle cx="140" cy="90" r="5"/><circle cx="520" cy="130" r="5"/><circle cx="80" cy="210" r="5"/>
      <circle cx="610" cy="190" r="5"/><circle cx="190" cy="320" r="5"/><circle cx="660" cy="290" r="5"/>
    </g>
  </svg>`);
}
