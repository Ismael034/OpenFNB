import React from "react";
import ReactDOM from "react-dom/client";
import { CssBaseline, ThemeProvider } from "@mui/material";
import App from "./App";
import { createAppTheme, type AppThemeMode } from "./theme";
import "./index.css";

function AppShell() {
  const [defaultThemeMode, setDefaultThemeMode] = React.useState<AppThemeMode>(() => {
    if (typeof window === "undefined") {
      return "light";
    }

    const saved = window.localStorage.getItem("openfnb-theme-mode");
    return saved === "dark" ? "dark" : "light";
  });
  const [themeMode, setThemeMode] = React.useState<AppThemeMode>(defaultThemeMode);

  React.useEffect(() => {
    document.documentElement.style.colorScheme = themeMode;
  }, [themeMode]);

  React.useEffect(() => {
    window.localStorage.setItem("openfnb-theme-mode", defaultThemeMode);
  }, [defaultThemeMode]);

  const theme = React.useMemo(() => createAppTheme(themeMode), [themeMode]);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <App
        defaultThemeMode={defaultThemeMode}
        onDefaultThemeModeChange={setDefaultThemeMode}
        onThemeModeChange={setThemeMode}
        themeMode={themeMode}
      />
    </ThemeProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppShell />
  </React.StrictMode>
);
