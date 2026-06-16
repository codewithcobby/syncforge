import type { MutateOptions, OptimisticHandler, SyncOperation } from "./types.js"

export type OptimisticApplyFn<TContext = unknown> = (
  operation: SyncOperation,
  context: TContext,
) => void | Promise<void>

export type OptimisticRollbackFn<TContext = unknown> = (
  operation: SyncOperation,
  error: unknown,
  context: TContext,
) => void | Promise<void>

export interface MergedOptimisticHandlers<TContext = unknown> {
  apply?: OptimisticApplyFn<TContext>
  rollback?: OptimisticRollbackFn<TContext>
}

export function resolveHandlers<TContext = unknown>(
  type: string,
  registry: Record<string, OptimisticHandler<TContext>> | undefined,
  inline: Pick<MutateOptions<TContext>, "optimisticUpdate" | "rollback"> | undefined,
): MergedOptimisticHandlers<TContext> {
  const registryHandler = registry?.[type]

  return {
    apply: inline?.optimisticUpdate ?? registryHandler?.apply,
    rollback: inline?.rollback ?? registryHandler?.rollback,
  }
}

export function hasHandlers(handlers: MergedOptimisticHandlers<unknown>): boolean {
  return handlers.apply !== undefined || handlers.rollback !== undefined
}
