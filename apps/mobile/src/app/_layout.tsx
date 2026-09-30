import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { DevBridge } from "@/components/DevBridge";
import { PushRouter } from "@/components/PushRouter";
import { ConnectionProvider } from "@/connection/ConnectionProvider";
import { useTheme } from "@/theme";

export default function RootLayout() {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 5_000, retry: 1 } } }),
  );
  const { colors, scheme } = useTheme();

  return (
    <QueryClientProvider client={queryClient}>
      <ConnectionProvider>
        {__DEV__ ? <DevBridge /> : null}
        <PushRouter />
        <StatusBar style={scheme === "dark" ? "light" : "dark"} />
        <Stack
          screenOptions={{
            headerTransparent: true,
            headerShadowVisible: false,
            headerTintColor: colors.accent,
            headerTitleStyle: { color: colors.text, fontWeight: "600" },
            headerLargeTitleStyle: { color: colors.text },
            headerBackButtonDisplayMode: "minimal",
            contentStyle: { backgroundColor: colors.background },
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen
            name="scan"
            options={{ headerShown: false, presentation: "fullScreenModal", animation: "fade" }}
          />
          <Stack.Screen name="chat/[botId]" options={{ title: "" }} />
          <Stack.Screen name="routines" options={{ title: "Routines", headerLargeTitle: true }} />
          <Stack.Screen name="logins" options={{ title: "Saved logins", headerLargeTitle: true }} />
        </Stack>
      </ConnectionProvider>
    </QueryClientProvider>
  );
}
