import React, { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";

export default function LoginScreen() {
  const { signIn, signUp } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"login" | "signup">("login");

  async function handleSubmit() {
    if (!email || !password) {
      Alert.alert("Preencha email e senha");
      return;
    }
    setLoading(true);
    const { error } = mode === "login" ? await signIn(email, password) : await signUp(email, password);
    setLoading(false);
    if (error) {
      Alert.alert("Erro", error);
    } else if (mode === "signup") {
      Alert.alert("Conta criada", "Verifique seu email para confirmar o cadastro.");
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>MotoristaPro</Text>
      <Text style={styles.subtitle}>
        {mode === "login" ? "Entre na sua conta" : "Crie sua conta"}
      </Text>

      <TextInput
        style={styles.input}
        placeholder="Email"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={styles.input}
        placeholder="Senha"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />

      <Pressable style={styles.button} onPress={handleSubmit} disabled={loading}>
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>{mode === "login" ? "Entrar" : "Cadastrar"}</Text>
        )}
      </Pressable>

      <Pressable onPress={() => setMode(mode === "login" ? "signup" : "login")}>
        <Text style={styles.switchText}>
          {mode === "login" ? "Não tem conta? Cadastre-se" : "Já tem conta? Entre"}
        </Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", padding: 24, backgroundColor: "#0F172A" },
  title: { fontSize: 32, fontWeight: "700", color: "#fff", textAlign: "center" },
  subtitle: { fontSize: 16, color: "#94A3B8", textAlign: "center", marginBottom: 32 },
  input: {
    backgroundColor: "#1E293B",
    color: "#fff",
    padding: 14,
    borderRadius: 10,
    marginBottom: 12,
    fontSize: 16
  },
  button: {
    backgroundColor: "#22C55E",
    padding: 16,
    borderRadius: 10,
    alignItems: "center",
    marginTop: 8
  },
  buttonText: { color: "#0F172A", fontWeight: "700", fontSize: 16 },
  switchText: { color: "#38BDF8", textAlign: "center", marginTop: 16 }
});
