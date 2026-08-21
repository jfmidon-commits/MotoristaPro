import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { ActivityIndicator, View } from "react-native";
import { useAuth } from "@/context/AuthContext";
import LoginScreen from "@/screens/LoginScreen";
import DashboardScreen from "@/screens/DashboardScreen";
import AddTransactionScreen from "@/screens/AddTransactionScreen";
import TransactionsScreen from "@/screens/TransactionsScreen";
import VehiclesScreen from "@/screens/VehiclesScreen";
import MaintenanceScreen from "@/screens/MaintenanceScreen";
import SyncStatusScreen from "@/screens/SyncStatusScreen";
import WorkSessionScreen from "@/screens/WorkSessionScreen";

const Stack = createNativeStackNavigator();

const screenOptions = {
  headerStyle: { backgroundColor: "#0F172A" },
  headerTintColor: "#fff",
  headerShadowVisible: false
};

export default function AppNavigator() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#0F172A" }}>
        <ActivityIndicator color="#38BDF8" size="large" />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={screenOptions}>
        {!isAuthenticated ? (
          <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
        ) : (
          <>
            <Stack.Screen name="Dashboard" component={DashboardScreen} options={{ headerShown: false }} />
            <Stack.Screen
              name="WorkSession"
              component={WorkSessionScreen}
              options={{ title: "Turno de trabalho" }}
            />
            <Stack.Screen
              name="AddTransaction"
              component={AddTransactionScreen}
              options={{ title: "Nova transação" }}
            />
            <Stack.Screen name="Transactions" component={TransactionsScreen} options={{ title: "Transações" }} />
            <Stack.Screen name="Vehicles" component={VehiclesScreen} options={{ title: "Veículos" }} />
            <Stack.Screen name="Maintenance" component={MaintenanceScreen} options={{ title: "Manutenção" }} />
            <Stack.Screen
              name="SyncStatus"
              component={SyncStatusScreen}
              options={{ title: "Status de Sincronização" }}
            />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
