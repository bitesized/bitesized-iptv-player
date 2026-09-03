export function ScreenPlaceholder({
  title,
  subtitle
}: {
  title: string
  subtitle?: string
}): JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      <h1 className="text-2xl font-semibold text-white">{title}</h1>
      {subtitle ? <p className="max-w-md text-sm text-neutral-400">{subtitle}</p> : null}
    </div>
  )
}
