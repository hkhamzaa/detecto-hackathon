import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  getModuleConfig,
  setCameraModule,
  setZoneModule,
  type ModuleConfig,
} from '@/lib/modules/api'

export const MODULES_KEY = ['modules'] as const

export function useModuleConfig() {
  return useQuery({
    queryKey: MODULES_KEY,
    queryFn: async () => {
      const result = await getModuleConfig()
      if (!result.ok) throw new Error(result.code)
      return result.config
    },
  })
}

/** The cache, with one camera's module switched on or off. */
function withModule(
  config: ModuleConfig,
  cameraId: string,
  moduleId: string,
  enabled: boolean,
): ModuleConfig {
  return {
    ...config,
    cameras: config.cameras.map((camera) => {
      if (camera.cameraId !== cameraId) return camera
      const has = camera.enabled.includes(moduleId)
      if (has === enabled) return camera
      return {
        ...camera,
        enabled: enabled
          ? [...camera.enabled, moduleId]
          : camera.enabled.filter((id) => id !== moduleId),
      }
    }),
  }
}

/**
 * One toggle, optimistic.
 *
 * A switch has to move under the finger — waiting half a second to find out
 * whether it moved makes the page feel broken. But the optimism stops at
 * success: if the write fails the switch goes back where it was and the row
 * says so. The interface never keeps showing a state the server did not agree
 * to, which is the same rule the alert confirmation follows, for a much smaller
 * decision.
 *
 * One instance per toggle, so a failure belongs to the row that caused it
 * rather than to the page.
 */
export function useSetModule(cameraId: string, moduleId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (enabled: boolean) => {
      const result = await setCameraModule(cameraId, moduleId, enabled)
      if (!result.ok) throw new Error(result.code)
      return result
    },

    onMutate: async (enabled) => {
      // Stop an in-flight refetch from landing on top of the optimistic write.
      await queryClient.cancelQueries({ queryKey: MODULES_KEY })
      const previous = queryClient.getQueryData<ModuleConfig>(MODULES_KEY)

      queryClient.setQueryData<ModuleConfig>(MODULES_KEY, (current) =>
        current ? withModule(current, cameraId, moduleId, enabled) : current,
      )

      return { previous }
    },

    onError: (_error, _enabled, context) => {
      if (context?.previous) {
        queryClient.setQueryData(MODULES_KEY, context.previous)
      }
    },

    // Whatever happened, the server gets the last word.
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: MODULES_KEY })
    },
  })
}

/**
 * The zone-wide change. Deliberately not optimistic: it is behind a confirm
 * step, so nobody is waiting on a switch to move, and guessing at forty rows
 * only to put them all back would be worse than a moment's wait.
 */
export function useSetZoneModule(zone: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (vars: { moduleId: string; enabled: boolean }) => {
      const result = await setZoneModule(zone, vars.moduleId, vars.enabled)
      if (!result.ok) throw new Error(result.code)
      return result
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: MODULES_KEY })
    },
  })
}
