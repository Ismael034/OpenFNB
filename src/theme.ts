import { alpha, createTheme } from "@mui/material/styles";

export type AppThemeMode = "dark" | "light";

export function createAppTheme(mode: AppThemeMode) {
  const isDark = mode === "dark";
  const textPrimary = isDark ? "#fafafa" : "#111113";
  const textSecondary = isDark ? "#a1a1aa" : "#52525b";
  const backgroundDefault = isDark ? "#09090b" : "#f5f5f4";
  const backgroundPaper = isDark ? "#111113" : "#ffffff";
  const borderBase = alpha(textPrimary, isDark ? 0.08 : 0.12);

  return createTheme({
    palette: {
      mode,
      primary: {
        main: isDark ? "#fafafa" : "#111113"
      },
      secondary: {
        main: textSecondary
      },
      success: {
        main: "#22c55e"
      },
      warning: {
        main: "#eab308"
      },
      error: {
        main: "#ef4444"
      },
      background: {
        default: backgroundDefault,
        paper: backgroundPaper
      },
      text: {
        primary: textPrimary,
        secondary: textSecondary
      }
    },
    shape: {
      borderRadius: 10
    },
    typography: {
      fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      h1: {
        fontSize: "1.5rem",
        fontWeight: 600,
        lineHeight: 1.2
      },
      h2: {
        fontSize: "1.125rem",
        fontWeight: 600
      },
      h3: {
        fontSize: "0.95rem",
        fontWeight: 600
      },
      button: {
        fontWeight: 500,
        textTransform: "none"
      }
    },
    components: {
      MuiCard: {
        styleOverrides: {
          root: {
            border: `1px solid ${borderBase}`,
            boxShadow: "none",
            backgroundImage: "none"
          }
        }
      },
      MuiButton: {
        styleOverrides: {
          root: {
            borderRadius: 8,
            paddingInline: 14,
            minHeight: 36
          },
          contained: {
            backgroundColor: isDark ? "#fafafa" : "#111113",
            color: isDark ? "#09090b" : "#fafafa",
            "&:hover": {
              backgroundColor: isDark ? "#e4e4e7" : "#27272a"
            }
          },
          outlined: {
            borderColor: alpha(textPrimary, isDark ? 0.12 : 0.18)
          }
        }
      },
      MuiChip: {
        styleOverrides: {
          root: {
            borderRadius: 999,
            backgroundColor: alpha(textPrimary, isDark ? 0.04 : 0.03),
            border: `1px solid ${borderBase}`
          },
          outlined: {
            borderColor: alpha(textPrimary, isDark ? 0.12 : 0.16)
          }
        }
      },
      MuiTableCell: {
        styleOverrides: {
          root: {
            borderBottom: `1px solid ${borderBase}`
          },
          head: {
            color: textSecondary,
            fontWeight: 500
          }
        }
      }
    }
  });
}
