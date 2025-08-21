// src/context/ThemeContext.tsx
import React, { createContext, useState, useContext, useEffect, ReactNode, useCallback } from 'react';
import { ActivityIndicator, Appearance, useColorScheme, View, Text, ColorValue } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Define the shape of our theme colors
export interface ThemeColors {
  icon: any;
  buttonText: any;
  border: any;
  secondary: string;
  textSecondary: string;
  background: string;
  cardBackground: string;
  text: string;
  secondaryText: string;
  placeholderText: string;
  borderColor: string;
  shadowColor: string;
  primary: string; // Main accent color
  primaryDark: string; // Darker shade of primary
  primaryLight: string; // Lighter shade of primary (e.g., for message bubbles)
  accent: string; // Secondary accent color (e.g., for certain UI elements)
  surface: string; // Color for cards, sheets, dialogs
  textPrimary: string; // Primary text color (same as 'text' usually)
  link: string; // Color for clickable links
  error: string; // Color for error messages
  placeholder: string; // Color for placeholder elements/backgrounds
  filterButtonBackground: string;
  activeFilterBackground: string;
  activeFilterText: string;
  success: string; // Added for completeness, if you use it later
  warning: string; // Added for completeness, if you use it later
  info: string;   // Added for completeness, if you use it later
}

// Define the light and dark theme color palettes
const lightColors: ThemeColors = {
  background: '#f0f2f5',
  cardBackground: '#ffffff',
  surface: '#ffffff', // Explicitly defined
  text: '#333333',
  secondaryText: '#666666',
  placeholderText: '#888888',
  borderColor: '#e0e0e0',
  shadowColor: '#000000',
  primary: '#6200EE', // Deep Purple
  primaryDark: '#3700B3', // Darker shade of primary
  primaryLight: '#BB86FC', // Lighter shade of primary, used for my messages
  accent: '#03DAC6', // Teal
  textPrimary: '#333333', // Alias for text
  link: '#2196F3', // Blue for links
  error: '#B00020', // Red for errors
  placeholder: '#BDBDBD', // Grey for placeholders
  filterButtonBackground: '#e0e0e0',
  activeFilterBackground: '#6200EE',
  activeFilterText: '#ffffff',
  success: '#4CAF50',
  warning: '#FFC107',
  info: '#2196F3',
  textSecondary: '#666666',
  secondary: '#666666',
  icon: undefined,
  buttonText: undefined,
  border: undefined
};

const darkColors: ThemeColors = {
  background: '#121212',
  cardBackground: '#1e1e1e',
  surface: '#1e1e1e', // Explicitly defined (same as cardBackground for consistency)
  text: '#e0e0e0',
  secondaryText: '#a0a0a0',
  placeholderText: '#777777',
  borderColor: '#333333',
  shadowColor: '#000000',
  primary: '#BB86FC', // Lighter purple accent for dark mode
  primaryDark: '#794BC4', // Darker shade for dark primary
  primaryLight: 'rgb(59, 26, 135)', // Even lighter shade for dark mode messages
  accent: '#03DAC6',
  textPrimary: '#E0E0E0', // Alias for text
  link: '#90CAF9', // Lighter blue for links in dark mode
  error: '#CF6679', // Lighter red for errors in dark mode
  placeholder: '#555555', // Darker grey for placeholders in dark mode
  filterButtonBackground: '#2a2a2a',
  activeFilterBackground: '#BB86FC',
  activeFilterText: '#121212', // Dark text on light background in dark mode
  success: '#66BB6A',
  warning: '#FFEB3B',
  info: '#64B5F6',
  textSecondary: '#a0a0a0',
  secondary: '#a0a0a0',
  icon: undefined,
  buttonText: undefined,
  border: undefined
};

// Define the context type
interface ThemeContextType {
  theme: 'light' | 'dark';
  colors: ThemeColors;
  toggleTheme: () => void;
  isThemeLoading: boolean;
}

// Create the context
export const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

// Define the key for AsyncStorage
const THEME_STORAGE_KEY = '@app_theme_preference';

// Create the ThemeProvider component
interface ThemeProviderProps {
  children: ReactNode;
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children }) => {
  const systemColorScheme = useColorScheme();
  const [theme, setTheme] = useState<'light' | 'dark' | null>(null);
  const [isThemeLoading, setIsThemeLoading] = useState(true);

  useEffect(() => {
    const loadTheme = async () => {
      try {
        const storedTheme = await AsyncStorage.getItem(THEME_STORAGE_KEY);
        if (storedTheme === 'light' || storedTheme === 'dark') {
          setTheme(storedTheme);
        } else {
          setTheme(systemColorScheme || 'light');
        }
      } catch (e) {
        console.error("Failed to load theme from AsyncStorage:", e);
        setTheme(systemColorScheme || 'light');
      } finally {
        setIsThemeLoading(false);
      }
    };

    loadTheme();
  }, [systemColorScheme]);

  useEffect(() => {
    if (theme !== null && !isThemeLoading) {
      const saveTheme = async () => {
        try {
          await AsyncStorage.setItem(THEME_STORAGE_KEY, theme);
        } catch (e) {
          console.error("Failed to save theme to AsyncStorage:", e);
        }
      };
      saveTheme();
    }
  }, [theme, isThemeLoading]);

  useEffect(() => {
    const subscription = Appearance.addChangeListener(({ colorScheme }) => {
      if (colorScheme) {
        setTheme(colorScheme);
      }
    });
    return () => subscription.remove();
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((prevTheme) => {
      const newTheme = prevTheme === 'light' ? 'dark' : 'light';
      return newTheme;
    });
  }, []);

  const colors = theme === 'light' ? lightColors : darkColors;

  if (isThemeLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: lightColors.background }}>
        <ActivityIndicator size="large" color={lightColors.primary} />
        <Text style={{ marginTop: 10, color: lightColors.text }}>Loading theme...</Text>
      </View>
    );
  }

  return (
    <ThemeContext.Provider value={{ theme: theme!, colors, toggleTheme, isThemeLoading }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
