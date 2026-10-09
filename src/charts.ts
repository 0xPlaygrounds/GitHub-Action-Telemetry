const MAX_POINTS = 60

// Averages consecutive values so a chart has at most MAX_POINTS points.
export function downsample(values: number[], maxPoints = MAX_POINTS): number[] {
  if (values.length <= maxPoints) return values
  const size = values.length / maxPoints
  return Array.from({ length: maxPoints }, (_, index) => {
    const bucket = values.slice(
      Math.floor(index * size),
      Math.floor((index + 1) * size)
    )
    return bucket.reduce((total, value) => total + value, 0) / bucket.length
  })
}

export interface Series {
  readonly name: string
  readonly color: string
  readonly values: number[]
}

const format = (value: number): string => String(Number(value.toFixed(1)))

// A Mermaid xychart. GitHub shows no legend for it, so the title names each line's color.
export function lineChart(options: {
  title: string
  yLabel: string
  minutes: number
  yMax?: number
  series: Series[]
}): string {
  const series = options.series.filter(item => item.values.length)
  if (!series.length) return ''
  const points = series.map(item => downsample(item.values))
  const yMax =
    options.yMax ??
    Math.max(1, ...points.flat().map(value => Math.ceil(value * 1.1)))
  const legend = series.map(item => `${item.name} (${item.color})`).join(', ')
  const palette = series.map(item => COLORS[item.color]).join(', ')
  return [
    '```mermaid',
    `%%{init: {"themeVariables": {"xyChart": {"plotColorPalette": "${palette}"}}}}%%`,
    'xychart-beta',
    `  title "${options.title}: ${legend}"`,
    `  x-axis "Minutes" 0 --> ${format(Math.max(options.minutes, 0.1))}`,
    `  y-axis "${options.yLabel}" 0 --> ${format(yMax)}`,
    ...points.map(values => `  line [${values.map(format).join(', ')}]`),
    '```'
  ].join('\n')
}

const COLORS: Record<string, string> = {
  blue: '#2563eb',
  red: '#dc2626'
}
