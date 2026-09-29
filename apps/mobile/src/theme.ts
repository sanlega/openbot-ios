import { useMemo } from "react";
import { StyleSheet, useColorScheme } from "react-native";

/** Mirrors the desktop tokens in `packages/ui/src/styles/global.css`. */
const dark = {
  background: "#0E0F11",
  surface: "#1A1B1F",
  surfaceRaised: "#232429",
  surfaceHigh: "#2C2D33",
  border: "#2A2B31",
  borderStrong: "#3A3B42",
  text: "#EDEDEF",
  muted: "#A0A1A8",
  subtle: "#6B6C74",
  accent: "#6E8BFF",
  accentFg: "#0B0C10",
  accentSoft: "rgba(110, 139, 255, 0.16)",
  userBubble: "#2B3566",
  userBubbleFg: "#EEF1FF",
  green: "#3FB27F",
  greenSoft: "rgba(63, 178, 127, 0.14)",
  amber: "#E5A83B",
  amberSoft: "rgba(229, 168, 59, 0.14)",
  red: "#F0626A",
  redSoft: "rgba(240, 98, 106, 0.14)",
  cos: "#B89CFF",
  overlay: "rgba(5, 6, 8, 0.55)",
};

export type Palette = typeof dark;

const light: Palette = {
  background: "#F6F6F8",
  surface: "#FFFFFF",
  surfaceRaised: "#F0F0F3",
  surfaceHigh: "#E7E7EC",
  border: "#E3E3E8",
  borderStrong: "#D0D0D7",
  text: "#18181B",
  muted: "#5F6068",
  subtle: "#8E8F97",
  accent: "#4F6BF0",
  accentFg: "#FFFFFF",
  accentSoft: "rgba(79, 107, 240, 0.12)",
  userBubble: "#4F6BF0",
  userBubbleFg: "#FFFFFF",
  green: "#23925F",
  greenSoft: "rgba(35, 146, 95, 0.12)",
  amber: "#B97710",
  amberSoft: "rgba(185, 119, 16, 0.12)",
  red: "#D63B44",
  redSoft: "rgba(214, 59, 68, 0.1)",
  cos: "#7C5CE0",
  overlay: "rgba(10, 10, 14, 0.4)",
};

export const palettes = { dark, light };

export const radius = { xs: 6, sm: 10, md: 14, lg: 18, xl: 24, full: 999 };
export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32 };
export const type = {
  caption: 11,
  footnote: 12,
  subhead: 13,
  body: 15,
  headline: 16,
  title3: 20,
  title2: 24,
  largeTitle: 32,
};

export function useTheme(): { colors: Palette; scheme: "dark" | "light" } {
  const scheme = useColorScheme() === "light" ? "light" : "dark";
  return { colors: palettes[scheme], scheme };
}

/** Builds a StyleSheet from the current palette; recomputed only when the scheme changes. */
export function makeStyles<T extends StyleSheet.NamedStyles<T>>(
  factory: (colors: Palette) => T,
): () => T {
  const cache = new Map<Palette, T>();
  return function useStyles() {
    const { colors } = useTheme();
    return useMemo(() => {
      let styles = cache.get(colors);
      if (!styles) {
        styles = StyleSheet.create(factory(colors));
        cache.set(colors, styles);
      }
      return styles;
    }, [colors]);
  };
}
