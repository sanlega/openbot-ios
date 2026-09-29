import { Tabs } from "expo-router";
import { colors } from "@/theme";
import { useQuery } from "@tanstack/react-query";
import { useConnection } from "@/connection/ConnectionProvider";
import { SymbolView, type SFSymbol } from "expo-symbols";

const tabTitle: Record<string, string> = {
  index: "Home",
  threads: "Threads",
  activity: "Activity",
  bots: "Bots",
  settings: "Settings",
};
const tabSymbol: Record<string, SFSymbol> = {
  index: "house",
  threads: "bubble.left.and.bubble.right",
  activity: "bell",
  bots: "person.2",
  settings: "gearshape",
};

export default function TabLayout() {
  const { client } = useConnection();
  const approvals = useQuery({
    queryKey: ["openbot", "approvals"],
    queryFn: () => client!.getApprovals("pending"),
    enabled: !!client,
  });
  return (
    <Tabs
      screenOptions={({ route }) => ({
        title: tabTitle[route.name] ?? route.name,
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: "700" },
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          height: 84,
          paddingTop: 9,
          paddingBottom: 24,
        },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontSize: 10, fontWeight: "600" },
        tabBarIcon: ({ color, focused }) => (
          <SymbolView
            name={tabSymbol[route.name] ?? "circle"}
            size={22}
            tintColor={color}
            weight={focused ? "semibold" : "regular"}
          />
        ),
      })}
    >
      <Tabs.Screen name="index" options={{ tabBarLabel: "Home" }} />
      <Tabs.Screen name="threads" options={{ tabBarLabel: "Threads" }} />
      <Tabs.Screen
        name="activity"
        options={{
          tabBarLabel: "Activity",
          tabBarBadge: approvals.data?.approvals.length || undefined,
          tabBarBadgeStyle: { backgroundColor: colors.accent, color: "#071425" },
        }}
      />
      <Tabs.Screen name="bots" options={{ tabBarLabel: "Bots" }} />
      <Tabs.Screen name="settings" options={{ tabBarLabel: "Settings" }} />
    </Tabs>
  );
}
