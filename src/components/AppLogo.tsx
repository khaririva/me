import React from 'react';

interface AppLogoProps {
  className?: string;
}

export const AppLogo: React.FC<AppLogoProps> = ({ className = 'h-8 w-8' }) => (
  <svg
    viewBox="0 0 512 512"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
  >
    <defs>
      <linearGradient id="pl-logo-bg" x1="40" y1="24" x2="472" y2="488" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#0F172A" />
        <stop offset="55%" stopColor="#1E3A8A" />
        <stop offset="100%" stopColor="#1D4ED8" />
      </linearGradient>
      <radialGradient id="pl-logo-glow" cx="50%" cy="46%" r="44%">
        <stop offset="0%" stopColor="#60A5FA" stopOpacity="0.32" />
        <stop offset="100%" stopColor="#1E3A8A" stopOpacity="0" />
      </radialGradient>
      <linearGradient id="pl-logo-gold" x1="296" y1="136" x2="380" y2="250" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#FBBF24" />
        <stop offset="100%" stopColor="#F59E0B" />
      </linearGradient>
    </defs>

    {/* Rounded square backdrop */}
    <rect x="20" y="20" width="472" height="472" rx="112" fill="url(#pl-logo-bg)" />
    <rect x="20" y="20" width="472" height="472" rx="112" fill="url(#pl-logo-glow)" />

    {/* Subtle book cover cradle base */}
    <path
      d="M108 338C108 349.046 116.954 358 128 358H222C236 358 248 364 256 374C264 364 276 358 290 358H384C395.046 358 404 349.046 404 338V348C404 361.255 393.255 372 380 372H292C277.5 372 264.5 379 256 388C247.5 379 234.5 372 220 372H132C118.745 372 108 361.255 108 348V338Z"
      fill="#60A5FA"
      fillOpacity="0.85"
    />

    {/* Left digital page (crisp white) */}
    <path
      d="M118 164C118 150.745 128.745 140 142 140H224C241.673 140 256 154.327 256 172V362C247.5 352 235.5 346 222 346H142C128.745 346 118 335.255 118 322V164Z"
      fill="#FFFFFF"
    />

    {/* Right digital page (cool luminous ice-tint) */}
    <path
      d="M394 164C394 150.745 383.255 140 370 140H288C270.327 140 256 154.327 256 172V362C264.5 352 276.5 346 290 346H370C383.255 346 394 335.255 394 322V164Z"
      fill="#E2E8F0"
    />

    {/* Center book spine seam */}
    <rect x="253" y="162" width="6" height="198" rx="3" fill="#94A3B8" fillOpacity="0.55" />

    {/* Minimalist literacy text lines on left page */}
    <rect x="144" y="186" width="84" height="10" rx="5" fill="#1E3A8A" fillOpacity="0.24" />
    <rect x="144" y="214" width="70" height="10" rx="5" fill="#1E3A8A" fillOpacity="0.18" />
    <rect x="144" y="242" width="80" height="10" rx="5" fill="#1E3A8A" fillOpacity="0.18" />
    <rect x="144" y="270" width="56" height="10" rx="5" fill="#1E3A8A" fillOpacity="0.14" />

    {/* Warm amber bookmark ribbon on right page */}
    <path d="M336 140H364V210L350 198L336 210V140Z" fill="url(#pl-logo-gold)" />

    {/* Crisp 4-point AI Spark emblem on right page */}
    <path
      d="M320 228C322.2 252.8 331.2 261.8 356 264C331.2 266.2 322.2 275.2 320 300C317.8 275.2 308.8 266.2 284 264C308.8 261.8 317.8 252.8 320 228Z"
      fill="url(#pl-logo-gold)"
    />
    <circle cx="358" cy="296" r="7" fill="#FBBF24" />
  </svg>
);
