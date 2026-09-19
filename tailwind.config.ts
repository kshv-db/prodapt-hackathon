import type { Config } from "tailwindcss";
import forms from "@tailwindcss/forms";
import containerQueries from "@tailwindcss/container-queries";

// Merged from the per-page Tailwind configs in the Stitch export (design source of truth).
// Page-level conflicts resolve to the dashboard values; see docs/FRONTEND.md.
const extend: Record<string, any> = { // eslint-disable-line @typescript-eslint/no-explicit-any
  "fontFamily": {
    "sans": [
      "\"Plus Jakarta Sans\"",
      "sans-serif"
    ],
    "currency-stat": [
      "Plus Jakarta Sans"
    ],
    "body-lg": [
      "Plus Jakarta Sans"
    ],
    "headline-sm": [
      "Plus Jakarta Sans"
    ],
    "label-sm": [
      "Plus Jakarta Sans"
    ],
    "label-md": [
      "Plus Jakarta Sans"
    ],
    "headline-lg": [
      "Plus Jakarta Sans"
    ],
    "headline-md": [
      "Plus Jakarta Sans"
    ],
    "label-lg": [
      "Plus Jakarta Sans"
    ],
    "display": [
      "Plus Jakarta Sans"
    ],
    "body-sm": [
      "Plus Jakarta Sans"
    ],
    "body-md": [
      "Plus Jakarta Sans"
    ],
    "display-mobile": [
      "Plus Jakarta Sans"
    ]
  },
  "colors": {
    "brand": {
      "cream": "#FAF7F2",
      "border": "#EFEBE4",
      "violet": "#8577F0",
      "violetLight": "#ECE9FC",
      "violetBorder": "#DFDAF7",
      "emerald": "#2E9E70",
      "mint": "#E3F4EA",
      "navy": "#1F2A44",
      "body": "#4A5268",
      "muted": "#8A91A3",
      "userBubble": "#DCEBFD",
      "botBubble": "#ECE9FC",
      "navInactive": "#4A5268",
      "cardBg": "#FFFFFF",
      "mintBg": "#E3F4EA",
      "coral": "#F26D6D",
      "coralLight": "#FDECEC",
      "sky": "#4F8CF0",
      "skyLight": "#EDF4FE",
      "amber": "#F6B43E",
      "amberLight": "#FEF7EC",
      "orange": "#E87C3E",
      "orangeLight": "#FDF2EB",
      "track": "#EEF0F4",
      "surface": "#FFFFFF",
      "slate": "#64748B",
      "mintSoft": "#E3F4EA",
      "violetBg": "#EDE9FE",
      "softLavender": "#ECE9FC",
      "purple": "#8577f0",
      "purple-hover": "#7465e0",
      "canvas": "#FAF7F2",
      "cardBorder": "#EFEBE4",
      "inputBorder": "#E4E0F5"
    },
    "surface-tint": "#5b4cc3",
    "background": "#fcf9f4",
    "on-error-container": "#93000a",
    "on-secondary": "#ffffff",
    "surface-bright": "#fcf9f4",
    "inverse-on-surface": "#f3f0eb",
    "on-primary-container": "#fffbff",
    "secondary-fixed-dim": "#71daa8",
    "tertiary-fixed-dim": "#ffb3b0",
    "primary": "#5849c0",
    "secondary-container": "#8af4c0",
    "surface-container-lowest": "#ffffff",
    "on-primary-fixed": "#170065",
    "on-tertiary": "#ffffff",
    "on-secondary-fixed": "#002113",
    "primary-fixed-dim": "#c7bfff",
    "on-tertiary-container": "#fffbff",
    "on-primary": "#ffffff",
    "surface-dim": "#dcdad5",
    "error-container": "#ffdad6",
    "on-error": "#ffffff",
    "secondary": "#006c48",
    "surface-container-highest": "#e5e2dd",
    "on-secondary-fixed-variant": "#005235",
    "primary-container": "#7163db",
    "tertiary-fixed": "#ffdad8",
    "on-tertiary-fixed-variant": "#871e24",
    "outline": "#787584",
    "tertiary-container": "#c54c4d",
    "on-surface-variant": "#474553",
    "surface-variant": "#e5e2dd",
    "tertiary": "#a53437",
    "primary-fixed": "#e4dfff",
    "inverse-surface": "#31302d",
    "error": "#ba1a1a",
    "on-tertiary-fixed": "#410006",
    "inverse-primary": "#c7bfff",
    "on-background": "#1c1c19",
    "surface": "#fcf9f4",
    "surface-container-high": "#ebe8e3",
    "outline-variant": "#c9c4d5",
    "on-secondary-container": "#00714c",
    "on-primary-fixed-variant": "#4331aa",
    "surface-container": "#f0ede9",
    "on-surface": "#1c1c19",
    "secondary-fixed": "#8df7c2",
    "surface-container-low": "#f6f3ee"
  },
  "boxShadow": {
    "card": "0 2px 8px -2px rgba(31, 42, 68, 0.05), 0 4px 16px -4px rgba(31, 42, 68, 0.04)",
    "subtle": "0 2px 8px rgba(0, 0, 0, 0.03)",
    "search": "0 4px 20px rgba(60, 50, 90, 0.06)",
    "floating": "0 6px 20px -4px rgba(31, 42, 68, 0.12), 0 2px 6px -1px rgba(31, 42, 68, 0.06)",
    "soft": "0 4px 20px -2px rgba(0, 0, 0, 0.05)",
    "cardHover": "0 8px 30px -4px rgba(0, 0, 0, 0.08)"
  },
  "borderRadius": {
    "DEFAULT": "0.25rem",
    "lg": "0.5rem",
    "xl": "0.75rem",
    "full": "9999px"
  },
  "spacing": {
    "margin-desktop": "2rem",
    "margin": "1.5rem",
    "gutter-desktop": "1.5rem",
    "space-lg": "1.5rem",
    "space-sm": "0.5rem",
    "gutter": "1.25rem",
    "space-xl": "2rem",
    "space-xs": "0.25rem",
    "sidebar-width": "220px",
    "space-md": "1rem"
  },
  "fontSize": {
    "currency-stat": [
      "28px",
      {
        "lineHeight": "36px",
        "letterSpacing": "-0.02em",
        "fontWeight": "800"
      }
    ],
    "body-lg": [
      "15px",
      {
        "lineHeight": "22px",
        "fontWeight": "400"
      }
    ],
    "headline-sm": [
      "16px",
      {
        "lineHeight": "24px",
        "fontWeight": "600"
      }
    ],
    "label-sm": [
      "11px",
      {
        "lineHeight": "14px",
        "letterSpacing": "0.02em",
        "fontWeight": "600"
      }
    ],
    "label-md": [
      "12px",
      {
        "lineHeight": "16px",
        "letterSpacing": "0.01em",
        "fontWeight": "600"
      }
    ],
    "headline-lg": [
      "24px",
      {
        "lineHeight": "32px",
        "letterSpacing": "-0.01em",
        "fontWeight": "700"
      }
    ],
    "headline-md": [
      "20px",
      {
        "lineHeight": "28px",
        "fontWeight": "600"
      }
    ],
    "label-lg": [
      "14px",
      {
        "lineHeight": "20px",
        "fontWeight": "600"
      }
    ],
    "display": [
      "32px",
      {
        "lineHeight": "40px",
        "letterSpacing": "-0.02em",
        "fontWeight": "700"
      }
    ],
    "body-sm": [
      "13px",
      {
        "lineHeight": "18px",
        "fontWeight": "400"
      }
    ],
    "body-md": [
      "14px",
      {
        "lineHeight": "20px",
        "fontWeight": "400"
      }
    ],
    "display-mobile": [
      "26px",
      {
        "lineHeight": "34px",
        "letterSpacing": "-0.01em",
        "fontWeight": "700"
      }
    ]
  }
};

const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      ...(extend as object),
      colors: {
        ...extend.colors,

      },
    },
  },
  plugins: [forms, containerQueries],
};

export default config;
