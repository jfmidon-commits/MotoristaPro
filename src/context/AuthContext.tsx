import React, { createContext, useContext, useEffect, useState } from "react";
import { Linking } from "react-native";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const EMAIL_CONFIRM_REDIRECT = "motoristapro://auth/confirm";

function parseAuthTokens(url: string) {
  const fragment = url.split("#")[1] ?? "";
  const query = url.includes("?") ? url.split("?")[1]?.split("#")[0] ?? "" : "";
  const params = new URLSearchParams(fragment || query);

  return {
    accessToken: params.get("access_token"),
    refreshToken: params.get("refresh_token"),
    errorDescription: params.get("error_description")
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function handleAuthUrl(url?: string | null) {
      if (!url || !url.startsWith("motoristapro://")) return;

      const { accessToken, refreshToken, errorDescription } = parseAuthTokens(url);
      if (errorDescription) {
        console.log("[AUTH] deep link retornou erro", errorDescription);
        return;
      }
      if (!accessToken || !refreshToken) return;

      const { data, error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken
      });
      if (error) throw error;
      if (mounted) setSession(data.session);
    }

    async function bootstrapSession() {
      try {
        const initialUrl = await Linking.getInitialURL();
        await handleAuthUrl(initialUrl);

        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (mounted) setSession(data.session);
      } catch (error) {
        console.log("[AUTH] falha ao restaurar sessão", error);
        if (mounted) setSession(null);
      } finally {
        if (mounted) setIsLoading(false);
      }
    }

    bootstrapSession();

    const linkSubscription = Linking.addEventListener("url", ({ url }) => {
      handleAuthUrl(url).catch((error) => console.log("[AUTH] falha ao processar deep link", error));
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!mounted) return;
      setSession(newSession);
      setIsLoading(false);
    });

    return () => {
      mounted = false;
      linkSubscription.remove();
      listener.subscription.unsubscribe();
    };
  }, []);

  const signIn: AuthContextValue["signIn"] = async (email, password) => {
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      return { error: error?.message ?? null };
    } catch (error: any) {
      return { error: error?.message ?? "Falha ao entrar. Verifique sua conexão e tente novamente." };
    }
  };

  const signUp: AuthContextValue["signUp"] = async (email, password) => {
    try {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: EMAIL_CONFIRM_REDIRECT }
      });
      return { error: error?.message ?? null };
    } catch (error: any) {
      return { error: error?.message ?? "Falha ao criar a conta. Verifique sua conexão e tente novamente." };
    }
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  };

  const value: AuthContextValue = {
    user: session?.user ?? null,
    session,
    isAuthenticated: !!session?.user,
    isLoading,
    signIn,
    signUp,
    signOut
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth precisa ser usado dentro de <AuthProvider>");
  return ctx;
}
