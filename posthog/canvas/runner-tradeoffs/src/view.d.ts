export declare const EMPTY_HINT: string

export declare function quote(value: unknown): string

export declare function percentChange(
  from: number | null | undefined,
  to: number | null | undefined
): number | null

export interface FrontierPoint {
  label: string
  duration: number | null
  cost: number | null
}

export declare function frontier(points: FrontierPoint[]): Set<string>

export declare function formatDuration(seconds: number | null | undefined): string

export declare function formatCost(usd: number | null | undefined): string

export declare function formatPercent(fraction: number | null | undefined): string
