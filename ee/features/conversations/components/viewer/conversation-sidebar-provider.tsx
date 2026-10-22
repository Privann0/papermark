"use client";

import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

import { cn } from "@/lib/utils";

interface ConversationSidebarContextType {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  open: () => void;
  close: () => void;
  toggle: () => void;
}

const ConversationSidebarContext =
  createContext<ConversationSidebarContextType | null>(null);

export function useConversationSidebar() {
  const context = useContext(ConversationSidebarContext);

  if (!context) {
    throw new Error(
      "useConversationSidebar must be used within ConversationSidebarProvider",
    );
  }

  return context;
}

export function useConversationSidebarSafe() {
  return useContext(ConversationSidebarContext);
}

export function ConversationSidebarProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((previous) => !previous), []);

  const value = useMemo(
    () => ({
      isOpen,
      setIsOpen,
      open,
      close,
      toggle,
    }),
    [isOpen, open, close, toggle],
  );

  return (
    <ConversationSidebarContext.Provider value={value}>
      {children}
    </ConversationSidebarContext.Provider>
  );
}

export function ConversationSidebarLayout({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const context = useConversationSidebarSafe();

  if (!context) {
    return <>{children}</>;
  }

  return (
    <div
      className={cn(
        "transition-all duration-300",
        context.isOpen && "pr-[400px]",
        className,
      )}
    >
      {children}
    </div>
  );
}
