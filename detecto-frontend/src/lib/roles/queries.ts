import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  deleteRole,
  getDirectory,
  invitePerson,
  saveRole,
  setPersonRole,
  setPersonStatus,
  type PersonStatus,
  type RoleDisposition,
  type RoleDraft,
} from '@/lib/roles/api'

export const DIRECTORY_KEY = ['org-directory'] as const

export function useDirectory() {
  return useQuery({
    queryKey: DIRECTORY_KEY,
    queryFn: async () => {
      const result = await getDirectory()
      if (!result.ok) throw new Error(result.code)
      return result.directory
    },
  })
}

/**
 * None of these are optimistic.
 *
 * A module toggle is optimistic because a switch has to move under the finger.
 * Nothing here is a switch: saving a role, deleting one, inviting somebody and
 * turning off their access are all deliberate acts behind a button, and every
 * one of them changes what a real person can see. Showing a result before the
 * server has agreed to it would be guessing about access control.
 */
function useDirectoryMutation<TVars, TData>(
  mutationFn: (vars: TVars) => Promise<TData>,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: DIRECTORY_KEY })
    },
  })
}

export function useSaveRole() {
  return useDirectoryMutation(async (draft: RoleDraft) => {
    const result = await saveRole(draft)
    if (!result.ok) throw new Error(result.code)
    return result.role
  })
}

export function useDeleteRole() {
  return useDirectoryMutation(
    async (vars: { id: string; disposition: RoleDisposition }) => {
      const result = await deleteRole(vars.id, vars.disposition)
      if (!result.ok) throw new Error(result.code)
      return result
    },
  )
}

export function useInvitePerson() {
  return useDirectoryMutation(async (vars: { email: string; roleId: string }) => {
    const result = await invitePerson(vars.email, vars.roleId)
    if (!result.ok) throw new Error(result.code)
    return result.person
  })
}

export function useSetPersonRole() {
  return useDirectoryMutation(async (vars: { id: string; roleId: string | null }) => {
    const result = await setPersonRole(vars.id, vars.roleId)
    if (!result.ok) throw new Error(result.code)
    return result.person
  })
}

export function useSetPersonStatus() {
  return useDirectoryMutation(
    async (vars: { id: string; status: Extract<PersonStatus, 'active' | 'deactivated'> }) => {
      const result = await setPersonStatus(vars.id, vars.status)
      if (!result.ok) throw new Error(result.code)
      return result.person
    },
  )
}
