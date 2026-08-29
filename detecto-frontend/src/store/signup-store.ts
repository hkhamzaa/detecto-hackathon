import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

import type { AccountType, OrgType } from '@/lib/plans'

export type CameraBucket = '1' | '2-3' | '4-6' | '7-12' | '12+'

/** Rough buckets. We size a plan from these; we never ask for an exact count. */
export const CAMERA_BUCKETS: {
  value: CameraBucket
  label: string
  /** Upper end of the bucket, used for plan sizing. */
  estimate: number
}[] = [
  { value: '1', label: '1', estimate: 1 },
  { value: '2-3', label: '2–3', estimate: 3 },
  { value: '4-6', label: '4–6', estimate: 6 },
  { value: '7-12', label: '7–12', estimate: 12 },
  { value: '12+', label: 'More than 12', estimate: 20 },
]

export const TOTAL_STEPS = 4
export type Step = 1 | 2 | 3 | 4

type HomeDetails = { cameras: CameraBucket | null; label: string }
type OrgDetails = { name: string; type: OrgType | ''; cameras: number; users: number }
type Account = { name: string; email: string; phone: string; password: string }
type Payment = {
  cardNumber: string
  expiry: string
  cvc: string
  cardName: string
  postcode: string
}

type SignupState = {
  step: Step
  complete: boolean
  accountType: AccountType | null
  home: HomeDetails
  org: OrgDetails
  account: Account
  /** null means "whatever we recommended"; set once the user picks explicitly. */
  planId: string | null
  payment: Payment

  chooseAccountType: (type: AccountType) => void
  patchHome: (patch: Partial<HomeDetails>) => void
  patchOrg: (patch: Partial<OrgDetails>) => void
  patchAccount: (patch: Partial<Account>) => void
  patchPayment: (patch: Partial<Payment>) => void
  selectPlan: (id: string) => void
  goNext: () => void
  goBack: () => void
  finish: () => void
  reset: () => void
}

const INITIAL = {
  step: 1 as Step,
  complete: false,
  accountType: null,
  home: { cameras: null, label: '' } satisfies HomeDetails,
  org: { name: '', type: '', cameras: 4, users: 2 } satisfies OrgDetails,
  account: { name: '', email: '', phone: '', password: '' } satisfies Account,
  planId: null,
  payment: {
    cardNumber: '',
    expiry: '',
    cvc: '',
    cardName: '',
    postcode: '',
  } satisfies Payment,
}

/**
 * Persisted to sessionStorage so a refresh mid-flow resumes where the customer
 * left off. Scoped to the tab, and gone when that tab closes.
 *
 * Two things are deliberately kept out of what gets written:
 *
 *   - the password, and
 *   - every card field.
 *
 * Both would otherwise sit in cleartext in storage that any script on the
 * origin can read, and a card verification code must not be retained at all.
 * They are re-entered after a refresh — which is what a checkout is expected
 * to do anyway. Everything else in the flow comes back.
 */
export const useSignupStore = create<SignupState>()(
  persist(
    (set) => ({
      ...INITIAL,

      // Step 1 is a fork, not a field: choosing advances immediately.
      chooseAccountType: (type) => set({ accountType: type, step: 2 }),

      patchHome: (patch) => set((s) => ({ home: { ...s.home, ...patch } })),
      patchOrg: (patch) => set((s) => ({ org: { ...s.org, ...patch } })),
      patchAccount: (patch) =>
        set((s) => ({ account: { ...s.account, ...patch } })),
      patchPayment: (patch) =>
        set((s) => ({ payment: { ...s.payment, ...patch } })),
      selectPlan: (id) => set({ planId: id }),

      goNext: () =>
        set((s) => ({ step: Math.min(TOTAL_STEPS, s.step + 1) as Step })),
      goBack: () => set((s) => ({ step: Math.max(1, s.step - 1) as Step })),
      finish: () => set({ complete: true }),
      reset: () => set({ ...INITIAL }),
    }),
    {
      name: 'detecto-signup',
      version: 1,
      storage: createJSONStorage(() => sessionStorage),

      partialize: (state) => ({
        step: state.step,
        complete: state.complete,
        accountType: state.accountType,
        home: state.home,
        org: state.org,
        // Name, email and phone come back. The password never leaves memory —
        // the key is kept so the merged shape stays intact.
        account: { ...state.account, password: '' },
        planId: state.planId,
        // `payment` is omitted entirely, so the empty initial card fields
        // survive the merge rather than being overwritten with stored ones.
      }),

      merge: (persisted, current) => {
        const merged = { ...current, ...(persisted as Partial<SignupState>) }
        // The password was not persisted, so a refresh that landed past the
        // credentials step would otherwise submit an empty one. Send them
        // back to re-enter it instead.
        if (!merged.complete && merged.step > 3 && !merged.account.password) {
          merged.step = 3
        }
        return merged
      },
    },
  ),
)
