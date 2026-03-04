import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { LanguageProvider, useTranslation } from "../LanguageContext";
import React from "react";

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <LanguageProvider>{children}</LanguageProvider>
);

describe("useTranslation", () => {
  it("returns Japanese translations by default", () => {
    // Clear localStorage to ensure default
    localStorage.removeItem("app-language");
    const { result } = renderHook(() => useTranslation(), { wrapper });
    expect(result.current.language).toBe("ja");
    expect(result.current.t("common.loading")).toBe("読み込み中");
  });

  it("switches to English when setLanguage('en') is called", () => {
    localStorage.removeItem("app-language");
    const { result } = renderHook(() => useTranslation(), { wrapper });
    act(() => {
      result.current.setLanguage("en");
    });
    expect(result.current.language).toBe("en");
    expect(result.current.t("common.loading")).toBe("Loading");
  });

  it("persists language choice to localStorage", () => {
    localStorage.removeItem("app-language");
    const { result } = renderHook(() => useTranslation(), { wrapper });
    act(() => {
      result.current.setLanguage("en");
    });
    expect(localStorage.getItem("app-language")).toBe("en");
  });

  it("returns key as fallback for unknown keys", () => {
    localStorage.removeItem("app-language");
    const { result } = renderHook(() => useTranslation(), { wrapper });
    // Cast to any to test with a non-existent key
    const t = result.current.t as (key: string) => string;
    expect(t("nonexistent.key")).toBe("nonexistent.key");
  });

  it("loads language from localStorage on init", () => {
    localStorage.setItem("app-language", "en");
    const { result } = renderHook(() => useTranslation(), { wrapper });
    expect(result.current.language).toBe("en");
    expect(result.current.t("common.cancel")).toBe("Cancel");
    // Clean up
    localStorage.removeItem("app-language");
  });
});
