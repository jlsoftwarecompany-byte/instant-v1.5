import React, { createContext, useContext, useEffect, useState } from "react";

type Theme = "white" | "black";

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem("instant-theme");
    return (saved as Theme) || "white";
  });

  useEffect(() => {
    localStorage.setItem("instant-theme", theme);
    // Apply theme classes to html element for global Tailwind theme switches
    const root = window.document.documentElement;
    if (theme === "black") {
      root.classList.add("dark-theme");
      root.classList.add("dark");
      root.style.setProperty("--background", "#04010a"); // Cyber black-purple
      root.style.setProperty("--foreground", "#f1f1fc"); // Soft glowing white
      root.style.setProperty("--card-bg", "#0b0518"); // Rich glowing deep purple container
      root.style.setProperty("--border-color", "#2c1251"); // Glowing violet border
      root.style.setProperty("--accent-text", "#25f4ee"); // TikTok Cyan
      root.style.setProperty("--muted-text", "#d4b3ff"); // Light lilac accent
      root.style.backgroundColor = "#04010a";
    } else {
      root.classList.remove("dark-theme");
      root.classList.remove("dark");
      root.style.setProperty("--background", "#f6f2ff"); // Soft lilac-toned daylight
      root.style.setProperty("--foreground", "#1a0833"); // Deep violet text
      root.style.setProperty("--card-bg", "#ffffff"); // Pure white card
      root.style.setProperty("--border-color", "#dbccfc"); // Pastel lilac border
      root.style.setProperty("--accent-text", "#fe2c55"); // TikTok pink accent action
      root.style.setProperty("--muted-text", "#8a3afc"); // Vivid rich purple
      root.style.backgroundColor = "#f6f2ff";
    }
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => (prev === "white" ? "black" : "white"));
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
};
