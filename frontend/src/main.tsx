import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";
import { Provider } from "react-redux";
import { store } from "./store/store";
import { createTheme, ThemeProvider, CssBaseline } from '@mui/material';

// Register the custom '2xl' breakpoint with the type system (value defined below).
declare module '@mui/material/styles' {
  interface BreakpointOverrides {
    '2xl': true;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FixMyCity design tokens — mirrors the hand-tuned palette already used across
// the app (teal authority brand + slate ink + civic status colors) so every
// MUI-defaulted surface now matches the bespoke screens. shape.borderRadius is
// kept at MUI's default 4 on purpose: existing components use numeric radii like
// `borderRadius: 3` (= 3 * 4 = 12px); changing the base would rescale them all.
// ─────────────────────────────────────────────────────────────────────────────

const BRAND = '#0f766e';          // deep civic teal — authority
const BRAND_LIGHT = '#14b8a6';    // bright teal — interactive accent (already app-wide)
const BRAND_DARK = '#0b5250';
const INK = '#0f172a';            // slate-900 — headings
const INK_SOFT = '#475569';       // slate-600 — body
const MUTED = '#64748b';          // slate-500 — captions

const theme = createTheme({
  breakpoints: {
    values: {
      xs: 0,
      sm: 600,
      md: 900,
      lg: 1200,
      xl: 1536,
      '2xl': 1920,
    },
  },
  palette: {
    mode: 'light',
    primary: {
      main: BRAND,
      light: BRAND_LIGHT,
      dark: BRAND_DARK,
      contrastText: '#ffffff',
    },
    secondary: {
      main: '#2563eb',           // civic blue — used in details/update accents
      light: '#3b82f6',
      dark: '#1d4ed8',
      contrastText: '#ffffff',
    },
    success: { main: '#059669', light: '#22c55e', dark: '#15803d', contrastText: '#ffffff' },
    warning: { main: '#d97706', light: '#f97316', dark: '#ea580c', contrastText: '#ffffff' },
    error:   { main: '#dc2626', light: '#ef4444', dark: '#b91c1c', contrastText: '#ffffff' },
    info:    { main: '#2563eb', light: '#3b82f6', dark: '#1d4ed8', contrastText: '#ffffff' },
    text: {
      primary: INK,
      secondary: INK_SOFT,
    },
    divider: 'rgba(15, 23, 42, 0.08)',
    background: {
      default: '#f4f8f6',
      paper: '#ffffff',
    },
  },
  shape: {
    borderRadius: 4,             // KEEP default — existing numeric radii depend on it
  },
  typography: {
    fontFamily: "'Plus Jakarta Sans', 'Inter', system-ui, 'Segoe UI', Roboto, sans-serif",
    h1: { fontWeight: 800, letterSpacing: '-0.03em' },
    h2: { fontWeight: 800, letterSpacing: '-0.03em' },
    h3: { fontWeight: 800, letterSpacing: '-0.025em' },
    h4: { fontWeight: 800, letterSpacing: '-0.02em' },
    h5: { fontWeight: 800, letterSpacing: '-0.02em' },
    h6: { fontWeight: 700, letterSpacing: '-0.01em' },
    subtitle1: { fontWeight: 600 },
    subtitle2: { fontWeight: 600 },
    button: { fontWeight: 700, textTransform: 'none', letterSpacing: '0.01em' },
    overline: { fontWeight: 700, letterSpacing: '0.08em' },
  },
  components: {
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: {
          borderRadius: 10,
          fontWeight: 700,
          paddingTop: 8,
          paddingBottom: 8,
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { fontWeight: 700, letterSpacing: '0.01em' },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: { backgroundImage: 'none' },
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          backgroundColor: INK,
          fontSize: '0.75rem',
          fontWeight: 600,
          borderRadius: 8,
          padding: '6px 10px',
        },
        arrow: { color: INK },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: 10,
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
            borderColor: BRAND_LIGHT,
            borderWidth: 1,
          },
        },
      },
    },
    MuiMenu: {
      styleOverrides: {
        paper: {
          borderRadius: 12,
          marginTop: 6,
          border: '1px solid rgba(15, 23, 42, 0.06)',
          boxShadow: '0 12px 32px rgba(15, 30, 28, 0.12), 0 4px 8px rgba(15, 30, 28, 0.04)',
        },
      },
    },
    MuiMenuItem: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          margin: '2px 6px',
          fontWeight: 600,
          fontSize: '0.9rem',
        },
      },
    },
    MuiCssBaseline: {
      styleOverrides: {
        '*::-webkit-scrollbar': { width: 8, height: 8 },
        '*::-webkit-scrollbar-track': { background: 'transparent' },
        '*::-webkit-scrollbar-thumb': { background: '#cbd5e1', borderRadius: 4 },
        '*::-webkit-scrollbar-thumb:hover': { background: '#94a3b8' },
      },
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Provider store={store}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <App />
      </ThemeProvider>
    </Provider>
  </React.StrictMode>,
)
