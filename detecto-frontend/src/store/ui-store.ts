import { create } from 'zustand'

/**
 * Light, ephemeral UI state only. Anything that comes from the API belongs in
 * TanStack Query, not here.
 */
type UiState = {
  navOpen: boolean
  toggleNav: () => void
  closeNav: () => void
}

export const useUiStore = create<UiState>((set) => ({
  navOpen: false,
  toggleNav: () => set((s) => ({ navOpen: !s.navOpen })),
  closeNav: () => set({ navOpen: false }),
}))
