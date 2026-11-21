interface BrandMarkProps {
  variant?: 'hero' | 'compact';
}

export function BrandMark({ variant = 'hero' }: BrandMarkProps) {
  if (variant === 'compact') {
    return (
      <div className="flex items-center gap-2.5 select-none">
        <svg
          width="28"
          height="28"
          viewBox="0 0 36 36"
          fill="none"
          aria-hidden="true"
          className="shrink-0"
        >
          <rect
            x="4"
            y="8"
            width="15"
            height="21"
            rx="2.5"
            transform="rotate(-11 4 8)"
            fill="#192822"
            stroke="#D4AF37"
            strokeWidth="1.4"
          />
          <rect
            x="16"
            y="6"
            width="15"
            height="21"
            rx="2.5"
            transform="rotate(10 16 6)"
            fill="#192822"
            stroke="#D4AF37"
            strokeWidth="1.4"
          />
          <rect
            x="10.5"
            y="5.5"
            width="15"
            height="22"
            rx="2.5"
            fill="#FAF8F2"
            stroke="#D4AF37"
            strokeWidth="1.5"
          />
          <path
            d="M18 11.5C18 11.5 14 15.2 14 17.6C14 19.2 15.2 20.1 16.4 20.1C17.1 20.1 17.7 19.7 18 19.2C18.3 19.7 18.9 20.1 19.6 20.1C20.8 20.1 22 19.2 22 17.6C22 15.2 18 11.5 18 11.5Z"
            fill="#111916"
          />
          <path d="M16.3 21.8H19.7L18 19.2L16.3 21.8Z" fill="#111916" />
        </svg>
        <span className="font-display text-lg font-semibold tracking-tight text-[#FAF8F2] whitespace-nowrap">
          Royal Patti
        </span>
      </div>
    );
  }

  return (
    <div className="select-none">
      <svg
        viewBox="0 0 420 132"
        className="w-full max-w-[400px] h-auto"
        role="img"
        aria-label="Royal Patti — 3 Patti Parlor"
      >
        <defs>
          <linearGradient id="goldLeaf" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#F5E3A3" />
            <stop offset="48%" stopColor="#D4AF37" />
            <stop offset="100%" stopColor="#9A761F" />
          </linearGradient>
        </defs>

        {/* Three fanned cards crest */}
        <g transform="translate(8, 12)">
          <rect
            x="6"
            y="18"
            width="42"
            height="60"
            rx="5"
            transform="rotate(-14 27 48)"
            fill="#14221C"
            stroke="url(#goldLeaf)"
            strokeWidth="1.8"
          />
          <rect
            x="32"
            y="18"
            width="42"
            height="60"
            rx="5"
            transform="rotate(14 53 48)"
            fill="#14221C"
            stroke="url(#goldLeaf)"
            strokeWidth="1.8"
          />
          <rect
            x="19"
            y="10"
            width="42"
            height="62"
            rx="5"
            fill="#FAF8F2"
            stroke="url(#goldLeaf)"
            strokeWidth="2"
          />
          {/* Corner A */}
          <text
            x="25"
            y="24"
            fill="#111815"
            fontFamily="Fraunces, Georgia, serif"
            fontSize="12"
            fontWeight="700"
          >
            A
          </text>
          {/* Center Spade */}
          <path
            d="M40 29C40 29 30.5 38.2 30.5 44C30.5 47.9 33.4 50.1 36.2 50.1C37.9 50.1 39.2 49.2 40 48C40.8 49.2 42.1 50.1 43.8 50.1C46.6 50.1 49.5 47.9 49.5 44C49.5 38.2 40 29 40 29Z"
            fill="#111815"
          />
          <path d="M36 55H44L40 47.8L36 55Z" fill="#111815" />
          {/* Crown diamond accent */}
          <polygon points="40,1 43,5 40,9 37,5" fill="url(#goldLeaf)" />
        </g>

        {/* Wordmark */}
        <text
          x="104"
          y="64"
          fill="#FAF8F2"
          fontFamily="Fraunces, Georgia, serif"
          fontSize="48"
          fontWeight="700"
          letterSpacing="-0.8"
        >
          Royal Patti
        </text>

        {/* Fine gold rule + parlor subtitle */}
        <line x1="106" y1="80" x2="388" y2="80" stroke="url(#goldLeaf)" strokeWidth="1" strokeOpacity="0.65" />
        <text
          x="106"
          y="102"
          fill="#D4AF37"
          fontFamily="Plus Jakarta Sans, sans-serif"
          fontSize="13"
          fontWeight="500"
          letterSpacing="2.4"
        >
          MULTIPLAYER 3 PATTI · CASHIER
        </text>
      </svg>
    </div>
  );
}
