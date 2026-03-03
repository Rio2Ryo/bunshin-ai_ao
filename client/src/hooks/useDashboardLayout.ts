import { useState, useCallback, useEffect } from "react";

export type WidgetId = "kpi" | "recentMatchings" | "friendsList" | "twinStatus" | "notifications" | "quickActions" | "analytics" | "briefing" | "qualityTrend" | "bookmarks";

export type WidgetLayout = {
  id: WidgetId;
  x: number;
  y: number;
  w: number;
  h: number;
  visible: boolean;
};

const STORAGE_KEY = "bunshin-dashboard-layout-v2";

const DEFAULT_LAYOUT: WidgetLayout[] = [
  { id: "kpi", x: 0, y: 0, w: 12, h: 1, visible: true },
  { id: "twinStatus", x: 0, y: 1, w: 6, h: 1, visible: true },
  { id: "quickActions", x: 6, y: 1, w: 6, h: 1, visible: true },
  { id: "recentMatchings", x: 0, y: 2, w: 6, h: 1, visible: true },
  { id: "friendsList", x: 6, y: 2, w: 6, h: 1, visible: true },
  { id: "notifications", x: 0, y: 3, w: 6, h: 1, visible: true },
  { id: "analytics", x: 6, y: 3, w: 6, h: 1, visible: true },
  { id: "briefing", x: 0, y: 4, w: 6, h: 1, visible: true },
  { id: "qualityTrend", x: 6, y: 4, w: 6, h: 1, visible: true },
  { id: "bookmarks", x: 0, y: 5, w: 6, h: 1, visible: true },
];

function loadLayout(): WidgetLayout[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as WidgetLayout[];
      // Validate each entry has required fields
      if (Array.isArray(parsed) && parsed.every(w => w.id && typeof w.x === "number")) {
        return parsed;
      }
    }
  } catch {}
  return DEFAULT_LAYOUT;
}

export function useDashboardLayout() {
  const [layout, setLayout] = useState<WidgetLayout[]>(loadLayout);
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  }, [layout]);

  const moveWidget = useCallback((id: WidgetId, x: number, y: number) => {
    setLayout(prev => prev.map(w => w.id === id ? { ...w, x, y } : w));
  }, []);

  const toggleWidget = useCallback((id: WidgetId) => {
    setLayout(prev => prev.map(w => w.id === id ? { ...w, visible: !w.visible } : w));
  }, []);

  const resetLayout = useCallback(() => {
    setLayout(DEFAULT_LAYOUT);
  }, []);

  const swapWidgets = useCallback((dragId: WidgetId, dropId: WidgetId) => {
    setLayout(prev => {
      const dragWidget = prev.find(w => w.id === dragId);
      const dropWidget = prev.find(w => w.id === dropId);
      if (!dragWidget || !dropWidget) return prev;
      return prev.map(w => {
        if (w.id === dragId) return { ...w, x: dropWidget.x, y: dropWidget.y, w: dropWidget.w };
        if (w.id === dropId) return { ...w, x: dragWidget.x, y: dragWidget.y, w: dragWidget.w };
        return w;
      });
    });
  }, []);

  return { layout, moveWidget, toggleWidget, resetLayout, isEditing, setIsEditing, swapWidgets };
}
